// ============================================================
// modules/payroll/payroll.service.js
// v2.0 — Phase 4: New payroll calculation engine.
// v2.1 — Step 3: generatePayroll() body moved to
//   payrollSnapshotService.js (the only module allowed to
//   persist Payroll documents). Re-exported here unchanged so
//   the public API (POST /payroll/generate) and every existing
//   import of generatePayroll from this file keep working
//   exactly as before — no behavior change, no response shape
//   change, no status-flow change.
//
// WHAT DID NOT CHANGE:
//   - getPayrolls(), getPayrollById() — untouched
//   - approvePayroll(), rejectPayroll(), markPayrollPaid() — untouched
//   - Duplicate guard logic — untouched (now lives in payrollSnapshotService.js)
//   - Batch insertMany pattern — untouched (now lives in payrollSnapshotService.js)
//   - buildBaseQuery() — untouched
//   - Status flow (draft → approved → paid) — untouched
//   - Paid payroll guard in adjustPayroll() — untouched
// ============================================================

import mongoose  from 'mongoose'
import Payroll   from '../../models/Payroll.model.js'
import ApiError  from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'

// ── Step 3: persistence + calculation now live in payrollSnapshotService.js ──
export { generatePayroll } from './payrollSnapshotService.js'

/**
 * Builds tenant/outlet scoped base query for payroll reads.
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

// ── getPayrolls ───────────────────────────────────────────────
// UNCHANGED from v1.0

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
// Sprint 8.2.6a: populate employeeId(name) and outletId(name) so
// PayrollDetailModal can render names without needing useEntityMap().
// getPayrolls() (list) is intentionally NOT populated — PayrollTable
// already resolves names via useEntityMap() and that architecture
// is left untouched. No calculation fields are affected.

export const getPayrollById = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)
    .populate('employeeId', 'name')
    .populate('outletId', 'name')
    .lean()

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  return payroll
}

// ── approvePayroll ────────────────────────────────────────────
// UNCHANGED from v1.0

export const approvePayroll = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status !== 'draft') {
    throw new ApiError(400, `Only draft payrolls can be approved. Current status: '${payroll.status}'`)
  }

  payroll.status     = 'approved'
  payroll.approvedBy = new mongoose.Types.ObjectId(user.userId)
  payroll.approvedAt = new Date()

  await payroll.save()
  return payroll.toObject()
}

// ── rejectPayroll ─────────────────────────────────────────────
// UNCHANGED from v1.0

export const rejectPayroll = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status === 'paid') {
    throw new ApiError(400, 'Paid payrolls cannot be reverted')
  }

  if (payroll.status !== 'approved') {
    throw new ApiError(400, `Only approved payrolls can be rejected. Current status: '${payroll.status}'`)
  }

  payroll.status     = 'draft'
  payroll.approvedBy = null
  payroll.approvedAt = null

  await payroll.save()
  return payroll.toObject()
}

// ── adjustPayroll ─────────────────────────────────────────────
// Phase 4 changes:
//   1. kasbon wired (was in validation since Phase 1 but not in service)
//   2. calculateTotalPay() uses new object-based formula with ?? 0 fallbacks
//      so pre-Phase-4 records with null new fields are handled safely

export const adjustPayroll = async ({ tenantId, user, payrollId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status === 'paid') {
    throw new ApiError(400, 'Paid payrolls cannot be adjusted')
  }

  // Apply adjustments
  if (data.manualBonus !== undefined) payroll.manualBonus = data.manualBonus
  if (data.deductions  !== undefined) payroll.deductions  = data.deductions
  if (data.kasbon      !== undefined) payroll.kasbon      = data.kasbon  // Phase 4: wired

  // Recalculate totalPay using updated formula.
  // ?? 0 on all fields handles pre-Phase-4 records where new fields are null.
  payroll.totalPay = calculateTotalPay(payroll)

  await payroll.save()
  return payroll.toObject()
}

// ── markPayrollPaid ───────────────────────────────────────────
// UNCHANGED from v1.0

export const markPayrollPaid = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status !== 'approved') {
    throw new ApiError(400, `Only approved payrolls can be marked paid. Current status: '${payroll.status}'`)
  }

  payroll.status = 'paid'
  await payroll.save()

  return payroll.toObject()
}