// ============================================================
// modules/payroll/payroll.service.js
// All payroll business logic.
//
// CALCULATION FORMULAS:
//
//   Monthly salary type:
//     salaryEarned = (baseSalary / workingDays) × presentDays
//
//   Daily salary type:
//     salaryEarned = baseSalary × presentDays
//
//   Final:
//     totalPay = salaryEarned + cupsBonus + manualBonus - deductions
//     (floor applied — no fractional currency)
//
// SNAPSHOT STRATEGY:
//   At generation time, salaryType and baseSalary are copied
//   from the Employee document into the Payroll record.
//   Subsequent employee salary changes do not affect existing payrolls.
//
// ATTENDANCE COUNTING:
//   'present' and 'late' count as attended days.
//   'absent', 'leave', 'holiday' do not.
//
// DUPLICATE GUARD:
//   The DB unique index on { tenantId, employeeId, period.month, period.year }
//   is the hard constraint. The service also pre-checks before
//   attempting generation and skips employees with existing
//   approved or paid payrolls (those are never overwritten).
//   Employees with existing draft payrolls are also skipped
//   to avoid unintended overwrite — the caller must reject/delete first.
// ============================================================

import mongoose from 'mongoose'
import Payroll    from '../../models/Payroll.model.js'
import Employee   from '../../models/Employee.model.js'
import Attendance from '../../models/Attendance.model.js'
import Sale       from '../../models/Sale.model.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'
import { PAYROLL_CONFIG } from '../../config/payroll.config.js'

// ── Helpers ───────────────────────────────────────────────────

/**
 * Builds the start and end Date for a month/year period.
 * Start: first day of month at 00:00:00 UTC
 * End:   last day of month at 23:59:59.999 UTC
 */
const getPeriodDateRange = (month, year) => {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const end   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  return { start, end }
}

/**
 * Calculates salaryEarned based on salary type.
 * Result is floored to avoid fractional currency units.
 *
 * @param {string} salaryType - 'monthly' | 'daily'
 * @param {number} baseSalary
 * @param {number} presentDays
 * @param {number} workingDays
 * @returns {number}
 */
const calculateSalaryEarned = (salaryType, baseSalary, presentDays, workingDays) => {
  if (salaryType === 'monthly') {
    return Math.floor((baseSalary / workingDays) * presentDays)
  }
  // daily
  return Math.floor(baseSalary * presentDays)
}

/**
 * Calculates totalPay from all components.
 * Ensures totalPay is never negative (clamped to 0).
 */
const calculateTotalPay = (salaryEarned, cupsBonus, manualBonus, deductions) => {
  return Math.max(0, Math.floor(salaryEarned + cupsBonus + manualBonus - deductions))
}

/**
 * Builds the base MongoDB query for payroll with tenant/outlet scope.
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

// ── generatePayroll ───────────────────────────────────────────

/**
 * Generates payroll records for all active employees in an outlet
 * for a given month/year period.
 *
 * Generation steps per employee:
 *   1. Pull attendance records for the period
 *   2. Count presentDays (present + late), absentDays (others)
 *   3. Pull sales aggregation (totalCupsSold)
 *   4. Apply snapshot: copy salaryType + baseSalary from Employee
 *   5. Calculate salaryEarned, cupsBonus, totalPay
 *   6. Insert payroll record (skip if one already exists)
 *
 * Returns a summary: { generated, skipped, skippedItems }
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - { outletId, month, year, workingDays }
 */
export const generatePayroll = async ({ tenantId, user, data }) => {
  const { outletId, month, year, workingDays } = data

  const tenantOid  = user.role !== ROLES.SUPER_ADMIN
    ? new mongoose.Types.ObjectId(tenantId)
    : null
  const outletOid  = new mongoose.Types.ObjectId(outletId)
  const { start, end } = getPeriodDateRange(Number(month), Number(year))

  // 1. Fetch all active employees for this outlet
  const employeeQuery = { outletId: outletOid, isActive: true }
  if (tenantOid) employeeQuery.tenantId = tenantOid

  const employees = await Employee.find(employeeQuery).lean()

  if (employees.length === 0) {
    return { generated: 0, skipped: 0, skippedItems: [] }
  }

  const skippedItems = []
  const payrollDocs  = []

  for (const employee of employees) {
    const employeeOid = employee._id

    // 2. Check for existing payroll for this period
    const existingQuery = {
      employeeId:    employeeOid,
      'period.month': Number(month),
      'period.year':  Number(year),
    }
    if (tenantOid) existingQuery.tenantId = tenantOid

    const existing = await Payroll.findOne(existingQuery).lean()

    if (existing) {
      skippedItems.push({
        employeeId:   employeeOid.toString(),
        employeeName: employee.name,
        reason:       `Payroll already exists with status '${existing.status}'`,
      })
      continue
    }

    // 3. Pull attendance for this employee in this period
    const attendanceRecords = await Attendance.find({
      ...(tenantOid ? { tenantId: tenantOid } : {}),
      employeeId: employeeOid,
      date:       { $gte: start, $lte: end },
    }).lean()

    // Count: present + late = attended; everything else = absent
    let presentDays = 0
    let absentDays  = 0

    for (const record of attendanceRecords) {
      if (record.status === 'present' || record.status === 'late') {
        presentDays++
      } else {
        absentDays++
      }
    }

    // 4. Pull sales aggregation for this employee in this period
    const salesAgg = await Sale.aggregate([
      {
        $match: {
          ...(tenantOid ? { tenantId: tenantOid } : {}),
          employeeId: employeeOid,
          date:       { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id:           null,
          totalCupsSold: { $sum: '$totalCups' },
        },
      },
    ])

    const totalCupsSold = salesAgg[0]?.totalCupsSold ?? 0

    // 5. Apply calculation
    const cupsBonus     = Math.floor(totalCupsSold * PAYROLL_CONFIG.BONUS_PER_CUP)
    const salaryEarned  = calculateSalaryEarned(
      employee.salaryType,
      employee.baseSalary,
      presentDays,
      Number(workingDays)
    )
    const totalPay = calculateTotalPay(salaryEarned, cupsBonus, 0, 0)

    // 6. Build payroll document (snapshot: copy salary fields from employee)
    payrollDocs.push({
      tenantId:     tenantOid ?? undefined,
      outletId:     outletOid,
      employeeId:   employeeOid,
      period:       { month: Number(month), year: Number(year) },
      // ── SNAPSHOT ──
      salaryType:   employee.salaryType,
      baseSalary:   employee.baseSalary,
      // ── Attendance ──
      workingDays:  Number(workingDays),
      presentDays,
      absentDays,
      // ── Sales ──
      totalCupsSold,
      cupsBonus,
      // ── Adjustments (defaults) ──
      manualBonus:  0,
      deductions:   0,
      // ── Calculated ──
      salaryEarned,
      totalPay,
      // ── Status & Audit ──
      status:       'draft',
      generatedBy:  new mongoose.Types.ObjectId(user.userId),
      generatedAt:  new Date(),
      approvedBy:   null,
      approvedAt:   null,
    })
  }

  // Batch insert — ordered: false so one failure doesn't abort the rest
  let generated = 0

  if (payrollDocs.length > 0) {
    try {
      const result = await Payroll.insertMany(payrollDocs, { ordered: false })
      generated = result.length
    } catch (err) {
      if (err.code === 11000 || err.name === 'BulkWriteError') {
        generated = err.result?.nInserted ?? 0
        const writeErrors = err.writeErrors ?? []
        for (const we of writeErrors) {
          const failedDoc = payrollDocs[we.index]
          if (failedDoc) {
            skippedItems.push({
              employeeId: failedDoc.employeeId.toString(),
              reason:     'Duplicate payroll record (concurrent generation)',
            })
          }
        }
      } else {
        throw err
      }
    }
  }

  return {
    generated,
    skipped:      skippedItems.length,
    skippedItems,
  }
}

// ── getPayrolls ───────────────────────────────────────────────

/**
 * Returns paginated payroll records with optional filters.
 */
export const getPayrolls = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  if (queryParams.outletId && user.role !== ROLES.MANAGER) {
    query.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.employeeId) {
    query.employeeId = new mongoose.Types.ObjectId(queryParams.employeeId)
  }

  if (queryParams.status) {
    query.status = queryParams.status
  }

  if (queryParams.month) {
    query['period.month'] = Number(queryParams.month)
  }

  if (queryParams.year) {
    query['period.year'] = Number(queryParams.year)
  }

  const [payrolls, total] = await Promise.all([
    Payroll.find(query)
      .sort({ 'period.year': -1, 'period.month': -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payroll.countDocuments(query),
  ])

  return {
    payrolls,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getPayrollById ────────────────────────────────────────────

export const getPayrollById = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query).lean()

  if (!payroll) {
    const err = new Error('Payroll record not found')
    err.statusCode = 404
    throw err
  }

  return payroll
}

// ── approvePayroll ────────────────────────────────────────────

/**
 * Transitions a draft payroll to approved.
 * Sets approvedBy and approvedAt from the authenticated user.
 *
 * @throws {Error} 400 if not in draft status
 */
export const approvePayroll = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    const err = new Error('Payroll record not found')
    err.statusCode = 404
    throw err
  }

  if (payroll.status !== 'draft') {
    const err = new Error(`Only draft payrolls can be approved. Current status: '${payroll.status}'`)
    err.statusCode = 400
    throw err
  }

  payroll.status     = 'approved'
  payroll.approvedBy = new mongoose.Types.ObjectId(user.userId)
  payroll.approvedAt = new Date()

  await payroll.save()
  return payroll.toObject()
}

// ── rejectPayroll ─────────────────────────────────────────────

/**
 * Reverts an approved payroll back to draft.
 * Clears approval metadata. Cannot revert paid payrolls.
 *
 * @throws {Error} 400 if not in approved status
 */
export const rejectPayroll = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    const err = new Error('Payroll record not found')
    err.statusCode = 404
    throw err
  }

  if (payroll.status === 'paid') {
    const err = new Error('Paid payrolls cannot be reverted')
    err.statusCode = 400
    throw err
  }

  if (payroll.status !== 'approved') {
    const err = new Error(`Only approved payrolls can be rejected. Current status: '${payroll.status}'`)
    err.statusCode = 400
    throw err
  }

  payroll.status     = 'draft'
  payroll.approvedBy = null
  payroll.approvedAt = null

  await payroll.save()
  return payroll.toObject()
}

// ── adjustPayroll ─────────────────────────────────────────────

/**
 * Manually adjusts manualBonus and/or deductions on a payroll.
 * Recalculates totalPay after adjustment.
 * Cannot adjust paid payrolls.
 *
 * @throws {Error} 400 if status is paid
 */
export const adjustPayroll = async ({ tenantId, user, payrollId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    const err = new Error('Payroll record not found')
    err.statusCode = 404
    throw err
  }

  if (payroll.status === 'paid') {
    const err = new Error('Paid payrolls cannot be adjusted')
    err.statusCode = 400
    throw err
  }

  if (data.manualBonus !== undefined) payroll.manualBonus = data.manualBonus
  if (data.deductions  !== undefined) payroll.deductions  = data.deductions

  // Recalculate totalPay with updated adjustments
  payroll.totalPay = calculateTotalPay(
    payroll.salaryEarned,
    payroll.cupsBonus,
    payroll.manualBonus,
    payroll.deductions
  )

  await payroll.save()
  return payroll.toObject()
}

// ── markPayrollPaid ───────────────────────────────────────────

/**
 * Transitions an approved payroll to paid.
 * Paid is terminal — no further transitions allowed.
 *
 * @throws {Error} 400 if not approved
 */
export const markPayrollPaid = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    const err = new Error('Payroll record not found')
    err.statusCode = 404
    throw err
  }

  if (payroll.status !== 'approved') {
    const err = new Error(`Only approved payrolls can be marked paid. Current status: '${payroll.status}'`)
    err.statusCode = 400
    throw err
  }

  payroll.status = 'paid'
  await payroll.save()

  return payroll.toObject()
}
