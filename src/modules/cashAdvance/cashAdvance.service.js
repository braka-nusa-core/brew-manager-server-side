// ============================================================
// modules/cashAdvance/cashAdvance.service.js
// Phase 3.5 — Rider Cash Advance / Kasbon.
//
// EXPLICITLY NOT a Wallet operation — no import of employeeWallet
// service/model, no EmployeeWalletLedger writes, no wallet balance
// change.
//
// Employee-role branching (rider gets automatic Payroll deduction,
// everyone else is record-only) is NOT decided here — this module
// treats every employee identically (create/list/outstanding-total).
// The role branch lives in payrollSnapshotService.js, which only ever
// calls claimOutstandingCashAdvances() for riders.
// ============================================================

import mongoose      from 'mongoose'
import CashAdvance   from '../../models/CashAdvance.model.js'
import Employee      from '../../models/Employee.model.js'
import ApiError       from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'

// ── Helpers ───────────────────────────────────────────────────

const normalizeDate = (value) => {
  const d = new Date(value)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

// Same shape as expense.service.js's buildBaseQuery — tenant-scoped
// for everyone except super_admin; outlet-locked for manager/cashier.
const buildBaseQuery = (tenantId, user) => {
  const query = {}

  if (user.role === ROLES.SUPER_ADMIN) return query

  query.tenantId = new mongoose.Types.ObjectId(tenantId)

  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    user.outletId
  ) {
    query.outletId = new mongoose.Types.ObjectId(user.outletId)
  }

  return query
}

// ── createCashAdvance ────────────────────────────────────────

/**
 * Records a new cash advance for an employee. Status always starts
 * 'outstanding' — no approval workflow, per Phase 3.5 scope.
 * Does NOT touch the Wallet in any way.
 */
export const createCashAdvance = async ({ tenantId, user, data }) => {
  const employeeQuery = buildBaseQuery(tenantId, user)
  employeeQuery._id = new mongoose.Types.ObjectId(data.employeeId)

  const employee = await Employee.findOne(employeeQuery).lean()
  if (!employee) {
    throw new ApiError(404, 'Employee not found')
  }

  const advance = await CashAdvance.create({
    tenantId:   employee.tenantId,
    outletId:   employee.outletId,   // snapshot at record time
    employeeId: employee._id,
    amount:     data.amount,
    date:       normalizeDate(data.date),
    notes:      data.notes.trim(),
    status:     'outstanding',
    recordedBy: new mongoose.Types.ObjectId(user.userId),
  })

  return advance.toObject()
}

// ── getCashAdvances ──────────────────────────────────────────

/**
 * Paginated list, tenant/outlet-safe.
 */
export const getCashAdvances = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  if (
    queryParams.outletId &&
    user.role !== ROLES.MANAGER &&
    user.role !== ROLES.CASHIER
  ) {
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
    if (queryParams.startDate) query.date.$gte = normalizeDate(queryParams.startDate)
    if (queryParams.endDate) {
      const end = normalizeDate(queryParams.endDate)
      end.setUTCHours(23, 59, 59, 999)
      query.date.$lte = end
    }
  }

  const [advances, total] = await Promise.all([
    CashAdvance.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CashAdvance.countDocuments(query),
  ])

  return {
    advances,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getOutstandingTotal ──────────────────────────────────────

/**
 * Sum of an employee's currently outstanding, unclaimed advances —
 * read-only, no writes. Display-only; NOT used by Payroll generation
 * (which uses claimOutstandingCashAdvances() below instead).
 */
export const getOutstandingTotal = async (tenantId, employeeId) => {
  const result = await CashAdvance.aggregate([
    {
      $match: {
        tenantId:         new mongoose.Types.ObjectId(tenantId),
        employeeId:       new mongoose.Types.ObjectId(employeeId),
        status:           'outstanding',
        settledPayrollId: null,
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])

  return result[0]?.total ?? 0
}

// ── claimOutstandingCashAdvances ─────────────────────────────
//
// Called ONLY from payrollSnapshotService.js, ONLY for riders, on
// every (re)generation of a draft payroll for that employee/period.
//
// "Claiming" = tagging currently-outstanding, not-yet-claimed advances
// with this payroll's _id (settledPayrollId), so:
//   1. A later-taken advance can't be silently swept into an
//      already-generated payroll's deduction.
//   2. Regenerating the SAME draft payroll re-evaluates from scratch
//      (releases its own previous claim first).
//   3. When this exact payroll is later marked 'paid', exactly these
//      claimed records — and only these — get settled.
//
// NEVER touches a record with status 'settled'.
//
// @returns {Promise<number>} total claimed amount
export const claimOutstandingCashAdvances = async (tenantId, employeeId, payrollId) => {
  const tenantOid   = new mongoose.Types.ObjectId(tenantId)
  const employeeOid = new mongoose.Types.ObjectId(employeeId)

  // Release this exact payroll's previous claim (regeneration-safe).
  await CashAdvance.updateMany(
    { tenantId: tenantOid, employeeId: employeeOid, settledPayrollId: payrollId, status: 'outstanding' },
    { $set: { settledPayrollId: null } }
  )

  const outstanding = await CashAdvance.find({
    tenantId:         tenantOid,
    employeeId:       employeeOid,
    status:           'outstanding',
    settledPayrollId: null,
  }).lean()

  if (outstanding.length === 0) {
    return 0
  }

  const total = outstanding.reduce((sum, a) => sum + a.amount, 0)

  await CashAdvance.updateMany(
    { _id: { $in: outstanding.map((a) => a._id) } },
    { $set: { settledPayrollId: payrollId } }
  )

  return total
}

// ── settleCashAdvancesForPayroll ─────────────────────────────
//
// Called ONLY from payroll.service.js#markPayrollPaid, at the exact
// moment a payroll transitions to 'paid'. Never called for 'draft' or
// 'approved'.
export const settleCashAdvancesForPayroll = async (payrollId) => {
  await CashAdvance.updateMany(
    { settledPayrollId: payrollId, status: 'outstanding' },
    { $set: { status: 'settled', settledAt: new Date() } }
  )
}