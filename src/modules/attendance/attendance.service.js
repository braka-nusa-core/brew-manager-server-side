// ============================================================
// modules/attendance/attendance.service.js
// All attendance business logic and DB operations.
//
// Key changes from v1 (aligned to spec v1.1):
//   - Employee existence is validated before every insert.
//   - Employee.outletId is the source of truth for outletId —
//     not the request body. Manager outlet restriction is checked
//     against employee.outletId, not a body field.
//   - Bulk body uses attendances[] (not employees[]).
//   - Bulk returns { successCount, failedCount, failedItems }
//     where each failedItem has { employeeId, reason }.
//   - Date normalization to midnight UTC is preserved.
//   - Duplicate guard is preserved (pre-check + DB unique index).
// ============================================================

import mongoose from 'mongoose'
import Attendance from '../../models/Attendance.model.js'
import Employee   from '../../models/Employee.model.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'
import { createDailyCreditInSession } from '../employeeWallet/employeeWallet.service.js'

// ── Helpers ───────────────────────────────────────────────────

/**
 * Normalizes any date value to midnight UTC.
 * Required so the unique index { tenantId, employeeId, date }
 * correctly prevents duplicate entries on the same calendar day.
 */
const normalizeDate = (value) => {
  const d = new Date(value)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
export { normalizeDate }

/**
 * Builds the base MongoDB query with tenant and outlet scope.
 * super_admin → no scope
 * tenant_admin → tenantId scope
 * manager      → tenantId + outletId scope
 */
const buildBaseQuery = (tenantId, user) => {
  const query = {}

  if (user.role === ROLES.SUPER_ADMIN) return query

  query.tenantId = new mongoose.Types.ObjectId(tenantId)

  if (user.role === ROLES.MANAGER && user.outletId) {
    query.outletId = new mongoose.Types.ObjectId(user.outletId)
  }

  return query
}

/**
 * Validates that an employee exists, belongs to the tenant,
 * and (for managers) belongs to the manager's outlet.
 *
 * Returns the employee document on success.
 * Returns { error: string } on failure — callers decide how to handle.
 *
 * @param {string} employeeId
 * @param {string} tenantId
 * @param {Object} user - req.user
 * @returns {Promise<{ employee: Object }|{ error: string }>}
 */
const validateEmployeeAccess = async (employeeId, tenantId, user) => {
  let employeeQuery = { _id: new mongoose.Types.ObjectId(employeeId) }

  // super_admin skips tenant/outlet scope
  if (user.role !== ROLES.SUPER_ADMIN) {
    employeeQuery.tenantId = new mongoose.Types.ObjectId(tenantId)
  }

  const employee = await Employee.findOne(employeeQuery).lean()

  if (!employee) {
    return { error: 'Employee not found or does not belong to this tenant' }
  }

  if (!employee.isActive) {
    return { error: 'Employee is inactive and cannot have attendance recorded' }
  }

  // Manager outlet restriction: employee must belong to manager's outlet
  if (
    user.role === ROLES.MANAGER &&
    employee.outletId.toString() !== user.outletId.toString()
  ) {
    return { error: 'Employee does not belong to your outlet' }
  }

  return { employee }
}

// ── createAttendance ──────────────────────────────────────────

/**
 * Creates a single attendance record.
 *
 * Steps:
 *   1. Validate employee exists in tenant (and outlet for manager).
 *   2. Derive outletId from employee record — not from body.
 *   3. Pre-check for duplicate on same date.
 *   4. Insert record.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - validated req.body
 * @returns {Promise<Object>} Created attendance document
 */
export const createAttendance = async ({ tenantId, user, data }) => {
  // 1. Validate employee
  const { employee, error } = await validateEmployeeAccess(
    data.employeeId,
    tenantId,
    user
  )

  if (error) {
    const err = new Error(error)
    err.statusCode = error.includes('not found') ? 404 : 403
    throw err
  }

  const normalizedDate = normalizeDate(data.date)
  const tenantOid      = new mongoose.Types.ObjectId(tenantId)
  const employeeOid    = new mongoose.Types.ObjectId(data.employeeId)

  // 2. Pre-check duplicate
  const existing = await Attendance.findOne({
    tenantId:   tenantOid,
    employeeId: employeeOid,
    date:       normalizedDate,
  }).lean()

  if (existing) {
    const err = new Error('Attendance already exists for this employee and date')
    err.statusCode = 409
    throw err
  }

  // 3. outletId derived from employee record
  const attendance = await Attendance.create({
    tenantId:   tenantOid,
    outletId:   employee.outletId,         // from DB — never from body
    employeeId: employeeOid,
    date:       normalizedDate,
    status:     data.status,
    notes:      data.notes?.trim() ?? null,
    recordedBy: new mongoose.Types.ObjectId(user.userId),
  })

  return attendance
}

// ── ensurePresentAttendance ────────────────────────────────────

/**
 * Auto-marks a rider PRESENT for a given date as a side effect of
 * Cup Record creation (the moment a manager/cashier creates the first
 * Cup Record for a rider on a day, that rider is considered present).
 * NOT an HTTP-facing operation — no `user`/role gating (this is a
 * system-triggered action, not a manual attendance entry), and MUST be
 * called from inside the caller's own mongoose session/transaction so
 * that:
 *   - if Cup Record creation fails anywhere (rider validation, FIFO
 *     consumption, duplicate check, document creation), this write is
 *     rolled back along with everything else — Attendance is never
 *     created for a failed Cup Record creation.
 *   - if this write itself fails, the whole creation transaction aborts
 *     too (consistent with the all-or-nothing pattern already used
 *     throughout cup.service.js).
 *
 * Idempotent by construction:
 *   - Uses findOneAndUpdate + upsert with $setOnInsert only, so if an
 *     Attendance record already exists for {tenantId, employeeId, date}
 *     (whatever its status — manually entered, from a prior Cup Record
 *     that day, holiday/leave, etc.), NOTHING is modified — no
 *     overwrite, no duplicate, and no error.
 *   - Backed by the model's existing unique index on
 *     { tenantId, employeeId, date }, which is the actual hard guarantee
 *     against duplicates at the DB level (not just an app-level check).
 *
 * @param {import('mongoose').ClientSession} session
 * @param {Object} params
 * @param {string|import('mongoose').Types.ObjectId} params.tenantId
 * @param {string|import('mongoose').Types.ObjectId} params.outletId
 * @param {string|import('mongoose').Types.ObjectId} params.employeeId - the rider (CupRecord.riderId)
 * @param {Date|string} params.date - MUST be the CupRecord's own date
 * @param {string|import('mongoose').Types.ObjectId} params.recordedBy - who created the CupRecord
 */
export const ensurePresentAttendance = async (
  session,
  { tenantId, outletId, employeeId, date, recordedBy }
) => {
  const tenantOid   = new mongoose.Types.ObjectId(tenantId)
  const outletOid   = new mongoose.Types.ObjectId(outletId)
  const employeeOid = new mongoose.Types.ObjectId(employeeId)
  const normalizedDate = normalizeDate(date)

  const rawResult = await Attendance.findOneAndUpdate(
    {
      tenantId:   tenantOid,
      employeeId: employeeOid,
      date:       normalizedDate,
    },
    {
      $setOnInsert: {
        tenantId:   tenantOid,
        outletId:   outletOid,
        employeeId: employeeOid,
        date:       normalizedDate,
        status:     'present',
        notes:      'Auto-generated from CupRecord creation',
        recordedBy: new mongoose.Types.ObjectId(recordedBy),
      },
    },
    {
      upsert:                true,
      new:                   true,
      setDefaultsOnInsert:   true,
      session,
      includeResultMetadata: true, // Phase 2.2 — needed to detect actual insert vs matched-existing below
    }
  )

  // Mongoose 8 / MongoDB driver: with includeResultMetadata, the raw
  // findAndModify ModifyResult is returned. `lastErrorObject.upserted`
  // is only set when this call performed an insert.
  const wasInserted = Boolean(rawResult?.lastErrorObject?.upserted)

  if (wasInserted) {
    await createDailyCreditInSession(session, {
      tenantId,
      employeeId,
      date:      normalizedDate,
      createdBy: recordedBy,
    })
  }
}

/**
 * Creates attendance records for multiple employees on one date.
 *
 * Processing strategy:
 *   - Each entry is validated individually (employee existence + outlet scope).
 *   - Valid entries are batched into insertMany (ordered: false).
 *   - DB-level duplicates caught from BulkWriteError are merged
 *     back into failedItems with reason "duplicate".
 *   - All failures are reported — none are silently ignored.
 *
 * Response shape:
 * {
 *   successCount: number,
 *   failedCount:  number,
 *   failedItems: [
 *     { employeeId: string, reason: string }
 *   ]
 * }
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - validated req.body
 * @returns {Promise<Object>}
 */
export const bulkCreateAttendance = async ({ tenantId, user, data }) => {
  const { date, attendances } = data

  const normalizedDate = normalizeDate(date)
  const tenantOid      = new mongoose.Types.ObjectId(tenantId)
  const recordedByOid  = new mongoose.Types.ObjectId(user.userId)

  const failedItems  = []
  const validDocs    = []
  const validIndices = [] // tracks original index for BulkWriteError mapping

  // ── Pass 1: Validate each entry individually ──────────────
  for (let i = 0; i < attendances.length; i++) {
    const entry = attendances[i]

    // a) Employee validation (existence + tenant + outlet scope)
    const { employee, error } = await validateEmployeeAccess(
      entry.employeeId,
      tenantId,
      user
    )

    if (error) {
      failedItems.push({ employeeId: entry.employeeId, reason: error })
      continue
    }

    // b) Pre-check duplicate
    const existing = await Attendance.findOne({
      tenantId:   tenantOid,
      employeeId: new mongoose.Types.ObjectId(entry.employeeId),
      date:       normalizedDate,
    }).lean()

    if (existing) {
      failedItems.push({
        employeeId: entry.employeeId,
        reason:     'Attendance already exists for this employee and date',
      })
      continue
    }

    // c) Valid — add to batch with outletId from employee record
    validDocs.push({
      tenantId:   tenantOid,
      outletId:   employee.outletId,    // from DB — not from body
      employeeId: new mongoose.Types.ObjectId(entry.employeeId),
      date:       normalizedDate,
      status:     entry.status,
      notes:      entry.notes?.trim() ?? null,
      recordedBy: recordedByOid,
    })
    validIndices.push(i)
  }

  // ── Pass 2: Batch insert valid docs ───────────────────────
  let successCount = 0

  if (validDocs.length > 0) {
    try {
      const result = await Attendance.insertMany(validDocs, { ordered: false })
      successCount = result.length
    } catch (err) {
      // ordered: false — partial inserts may succeed
      if (err.code === 11000 || err.name === 'BulkWriteError') {
        successCount = err.result?.nInserted ?? 0

        const writeErrors = err.writeErrors ?? []
        for (const we of writeErrors) {
          const failedDoc = validDocs[we.index]
          if (failedDoc) {
            failedItems.push({
              employeeId: failedDoc.employeeId.toString(),
              reason:     we.code === 11000
                ? 'Attendance already exists for this employee and date'
                : `Insert error: ${we.errmsg}`,
            })
          }
        }
      } else {
        throw err
      }
    }
  }

  return {
    successCount,
    failedCount: failedItems.length,
    failedItems,
  }
}

// ── getAttendances ────────────────────────────────────────────

/**
 * Returns paginated attendance records with optional filters.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.queryParams - req.query
 */
export const getAttendances = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  // outletId filter — managers are already locked in buildBaseQuery
  if (queryParams.outletId && user.role !== ROLES.MANAGER) {
    query.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.employeeId) {
    query.employeeId = new mongoose.Types.ObjectId(queryParams.employeeId)
  }

  if (queryParams.status) {
    query.status = queryParams.status
  }

  if (queryParams.startDate || queryParams.endDate) {
    query.date = {}
    if (queryParams.startDate) {
      query.date.$gte = normalizeDate(queryParams.startDate)
    }
    if (queryParams.endDate) {
      const end = normalizeDate(queryParams.endDate)
      end.setUTCHours(23, 59, 59, 999)
      query.date.$lte = end
    }
  }

  const [attendances, total] = await Promise.all([
    Attendance.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Attendance.countDocuments(query),
  ])

  return {
    attendances,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getAttendanceById ─────────────────────────────────────────

/**
 * Returns a single attendance record scoped to tenant/outlet.
 */
export const getAttendanceById = async ({ tenantId, user, attendanceId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(attendanceId)

  const attendance = await Attendance.findOne(query).lean()

  if (!attendance) {
    const err = new Error('Attendance record not found')
    err.statusCode = 404
    throw err
  }

  return attendance
}

// ── updateAttendance ──────────────────────────────────────────

/**
 * Updates status and/or notes on an existing attendance record.
 * Only these two fields are mutable after creation.
 */
export const updateAttendance = async ({ tenantId, user, attendanceId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(attendanceId)

  const updateData = {}
  if (data.status !== undefined) updateData.status = data.status
  if (data.notes  !== undefined) updateData.notes  = data.notes?.trim() ?? null

  const attendance = await Attendance.findOneAndUpdate(
    query,
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!attendance) {
    const err = new Error('Attendance record not found')
    err.statusCode = 404
    throw err
  }

  return attendance
}

// ── deleteAttendance ──────────────────────────────────────────

/**
 * Hard deletes an attendance record.
 * Incorrect entries are deleted and re-submitted.
 * The unique index prevents accidental duplicate re-entry.
 */
export const deleteAttendance = async ({ tenantId, user, attendanceId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(attendanceId)

  const attendance = await Attendance.findOneAndDelete(query).lean()

  if (!attendance) {
    const err = new Error('Attendance record not found')
    err.statusCode = 404
    throw err
  }
}