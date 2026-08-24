// ============================================================
// modules/employeeWallet/employeeWallet.service.js
// Phase 2.1 — Employee Wallet foundation.
// Phase 2.1 FINAL revision — transaction ownership moved to the caller:
//   - createLedgerEntry(session, payload) REQUIRES a caller-owned
//     session and never opens/commits its own transaction — exactly
//     like consumeFifo(session, {...}) in inventory.service.js.
//   - createDailyCredit()/createWithdrawal()/createAdjustment() each
//     own startSession()/withTransaction() themselves and pass
//     `session` into createLedgerEntry().
//
// Phase 2.2 — automatic daily allowance credit, wired into Attendance:
//   - createDailyCreditInSession(session, payload) added: the actual
//     daily-credit business logic, callable with a CALLER-owned
//     session — this is what attendance.service.js#ensurePresentAttendance
//     calls directly using CupRecord creation's existing session.
//   - createDailyCredit({...}) is a thin wrapper: opens its own
//     session, delegates to createDailyCreditInSession().
//
// Phase 2.3 — read/reporting foundation, no write-behavior change:
//   - getWalletSummary(tenantId, employeeId, {startDate?, endDate?})
//     added: aggregation-based credits/withdrawals/adjustments/netChange
//     breakdown over an optional date range, plus the TRUE current
//     balance (never limited by the requested range).
//   - getEmployeeWalletOverview(tenantId, employeeId) added: combines
//     Employee identity/config fields with the derived balance —
//     service-level only, no dedicated route.
//
// Phase 2.4 — manual wallet transactions:
//   - createManualEntry({tenantId, employeeId, type, amount, date,
//     createdBy, notes}) added: wires the previously schema-only
//     manual_credit/manual_debit types to an actual write path.
//     External `amount` is always positive; sign resolved internally.
//     manual_debit reuses evaluateWithdrawalRule() for the overdraw
//     check. No Payroll interaction of any kind.
//
// Owns all EmployeeWalletLedger read/write logic. This is the ONLY
// module allowed to write EmployeeWalletLedger documents — mirrors the
// "one writer" convention already used by inventory.service.js for
// InventoryTransaction/InventoryBatch.
// ============================================================

import mongoose             from 'mongoose'
import EmployeeWalletLedger, { WALLET_TRANSACTION_TYPES } from '../../models/EmployeeWalletLedger.model.js'
import Employee              from '../../models/Employee.model.js'
import ApiError               from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── Helpers ───────────────────────────────────────────────────

const toMidnightUTC = (dateInput) => {
  const d = new Date(dateInput)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Loads and tenant-validates the employee this wallet transaction is for.
 * @param {import('mongoose').ClientSession} [session]
 */
const loadEmployee = async (tenantId, employeeId, session = null) => {
  let query = Employee.findOne({
    _id:      new mongoose.Types.ObjectId(employeeId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })
  if (session) query = query.session(session)

  const employee = await query.lean()

  if (!employee) {
    throw new ApiError(404, 'Employee not found')
  }

  return employee
}

/**
 * Overdraw-prevention rule — a debit (withdrawal OR manual_debit)
 * cannot exceed the current balance. Isolated so it can become
 * configurable later without restructuring createLedgerEntry()/
 * createWithdrawal()/createManualEntry() themselves.
 *
 * @param {string} [label] - 'Withdrawal' (default) or 'Manual debit'
 */
const evaluateWithdrawalRule = (currentBalance, amount, label = 'Withdrawal') => {
  if (amount > currentBalance) {
    return {
      allowed: false,
      reason:  `${label} amount (${amount}) exceeds current balance (${currentBalance})`,
    }
  }
  return { allowed: true }
}

// ── getCurrentBalance ────────────────────────────────────────

/**
 * Derives an employee's current wallet balance from the ledger.
 * Balance is never stored on Employee — always the most recent
 * ledger entry's balanceAfter, falling back to 0 if none exist.
 *
 * @param {import('mongoose').ClientSession} [session]
 */
export const getCurrentBalance = async (tenantId, employeeId, session = null) => {
  let query = EmployeeWalletLedger.findOne({
    tenantId:   new mongoose.Types.ObjectId(tenantId),
    employeeId: new mongoose.Types.ObjectId(employeeId),
  }).sort({ createdAt: -1 })
  if (session) query = query.session(session)

  const latest = await query.lean()

  return latest?.balanceAfter ?? 0
}

// ── createLedgerEntry ────────────────────────────────────────
// Single internal writer used by EVERY transaction type. Requires a
// caller-owned session — never opens/commits its own transaction.
const createLedgerEntry = async (session, {
  tenantId, outletId, employeeId, date, type, amount, notes, createdBy,
}) => {
  if (!session) {
    throw new ApiError(500, 'createLedgerEntry requires a caller-owned mongoose session')
  }
  if (!WALLET_TRANSACTION_TYPES.includes(type)) {
    throw new ApiError(400, `type must be one of: ${WALLET_TRANSACTION_TYPES.join(', ')}`)
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    throw new ApiError(400, 'amount must be a non-zero finite number')
  }

  const currentBalance = await getCurrentBalance(tenantId, employeeId, session)
  const balanceAfter   = currentBalance + amount

  const created = await EmployeeWalletLedger.create([{
    tenantId:   new mongoose.Types.ObjectId(tenantId),
    outletId:   new mongoose.Types.ObjectId(outletId),
    employeeId: new mongoose.Types.ObjectId(employeeId),
    date:       toMidnightUTC(date),
    type,
    amount,
    balanceAfter,
    notes:      notes?.trim() ?? null,
    createdBy:  new mongoose.Types.ObjectId(createdBy),
  }], { session })

  return created[0].toObject()
}

// ── createDailyCreditInSession ───────────────────────────────
// Phase 2.2. Session-aware daily-credit core logic — callable from
// INSIDE an already-open transaction (attendance.service.js).
export const createDailyCreditInSession = async (session, { tenantId, employeeId, date, createdBy, notes }) => {
  if (!session) {
    throw new ApiError(500, 'createDailyCreditInSession requires a caller-owned mongoose session')
  }

  const employee = await loadEmployee(tenantId, employeeId, session)

  if (!employee.isActive) {
    throw new ApiError(400, 'Employee is inactive and cannot be credited a daily allowance')
  }

  const amount = employee.dailyAllowanceAmount ?? 25000

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Employee dailyAllowanceAmount must be greater than 0 to credit')
  }

  return createLedgerEntry(session, {
    tenantId,
    outletId:   employee.outletId,
    employeeId,
    date,
    type:       'daily_credit',
    amount,
    notes:      notes ?? 'Daily allowance credit',
    createdBy,
  })
}

// ── createDailyCredit ────────────────────────────────────────
// Public, HTTP-facing-shaped wrapper (no session parameter) — owns
// its own session/transaction, delegates to createDailyCreditInSession().
export const createDailyCredit = async ({ tenantId, employeeId, date, createdBy, notes }) => {
  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      result = await createDailyCreditInSession(session, { tenantId, employeeId, date, createdBy, notes })
    })
  } finally {
    await session.endSession()
  }

  return result
}

// ── createWithdrawal ─────────────────────────────────────────

export const createWithdrawal = async ({ tenantId, employeeId, amount, date, createdBy, notes }) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Withdrawal amount must be a positive number')
  }

  const employee            = await loadEmployee(tenantId, employeeId)
  const currentBalance      = await getCurrentBalance(tenantId, employeeId)
  const { allowed, reason } = evaluateWithdrawalRule(currentBalance, amount)
  if (!allowed) {
    throw new ApiError(400, reason)
  }

  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      result = await createLedgerEntry(session, {
        tenantId,
        outletId:   employee.outletId,
        employeeId,
        date,
        type:       'withdrawal',
        amount:     -amount,
        notes,
        createdBy,
      })
    })
  } finally {
    await session.endSession()
  }

  return result
}

// ── createAdjustment ─────────────────────────────────────────

export const createAdjustment = async ({ tenantId, employeeId, amount, date, createdBy, notes }) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    throw new ApiError(400, 'Adjustment amount must be a non-zero number')
  }

  if (!notes || !notes.trim()) {
    throw new ApiError(400, 'notes is required for an adjustment (explain the correction)')
  }

  const employee = await loadEmployee(tenantId, employeeId)

  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      result = await createLedgerEntry(session, {
        tenantId,
        outletId:   employee.outletId,
        employeeId,
        date,
        type:       'adjustment',
        amount,
        notes,
        createdBy,
      })
    })
  } finally {
    await session.endSession()
  }

  return result
}

// ── createManualEntry ────────────────────────────────────────
// Phase 2.4. Single public function covering BOTH manual_credit and
// manual_debit. External API always takes a POSITIVE `amount` for
// both types; converted to the correct signed ledger amount internally.
export const createManualEntry = async ({ tenantId, employeeId, type, amount, date, createdBy, notes }) => {
  if (type !== 'manual_credit' && type !== 'manual_debit') {
    throw new ApiError(400, "type must be one of: manual_credit, manual_debit")
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'amount must be a positive finite number')
  }

  if (!notes || !notes.trim()) {
    throw new ApiError(400, 'notes is required for a manual wallet transaction (explain the reason)')
  }

  const employee = await loadEmployee(tenantId, employeeId)

  if (!employee.isActive) {
    throw new ApiError(400, 'Employee is inactive and cannot receive a manual wallet transaction')
  }

  const signedAmount = type === 'manual_credit' ? amount : -amount

  if (type === 'manual_debit') {
    const currentBalance      = await getCurrentBalance(tenantId, employeeId)
    const { allowed, reason } = evaluateWithdrawalRule(currentBalance, amount, 'Manual debit')
    if (!allowed) {
      throw new ApiError(400, reason)
    }
  }

  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      result = await createLedgerEntry(session, {
        tenantId,
        outletId:   employee.outletId,
        employeeId,
        date,
        type,
        amount:     signedAmount,
        notes,
        createdBy,
      })
    })
  } finally {
    await session.endSession()
  }

  return result
}

// ── getWalletSummary ─────────────────────────────────────────
// Phase 2.3, extended Phase 2.6 (dailyCreditTotal bucket for Payroll).
export const getWalletSummary = async (tenantId, employeeId, range = {}) => {
  await loadEmployee(tenantId, employeeId)

  const tenantOid   = new mongoose.Types.ObjectId(tenantId)
  const employeeOid = new mongoose.Types.ObjectId(employeeId)

  const match = { tenantId: tenantOid, employeeId: employeeOid }

  let startDate = null
  let endDate   = null

  if (range.startDate || range.endDate) {
    match.date = {}
    if (range.startDate) {
      startDate    = toMidnightUTC(range.startDate)
      match.date.$gte = startDate
    }
    if (range.endDate) {
      endDate      = toMidnightUTC(range.endDate)
      match.date.$lte = endDate
    }
  }

  const [agg] = await EmployeeWalletLedger.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalCredits: {
          $sum: {
            $cond: [{ $in: ['$type', ['daily_credit', 'manual_credit']] }, '$amount', 0],
          },
        },
        // Phase 2.6 addition — pure daily_credit-only total, distinct
        // from totalCredits above (which also includes manual_credit).
        // Payroll's rider-allowance integration needs specifically the
        // attendance-driven daily_credit sum.
        dailyCreditTotal: {
          $sum: {
            $cond: [{ $eq: ['$type', 'daily_credit'] }, '$amount', 0],
          },
        },
        totalWithdrawals: {
          $sum: {
            $cond: [{ $in: ['$type', ['withdrawal', 'manual_debit']] }, { $abs: '$amount' }, 0],
          },
        },
        totalAdjustments: {
          $sum: {
            $cond: [{ $eq: ['$type', 'adjustment'] }, '$amount', 0],
          },
        },
        netChange: { $sum: '$amount' },
      },
    },
  ])

  const currentBalance = await getCurrentBalance(tenantId, employeeId)

  return {
    employeeId,
    startDate:        startDate ? startDate.toISOString() : null,
    endDate:          endDate ? endDate.toISOString() : null,
    totalCredits:     agg?.totalCredits ?? 0,
    dailyCreditTotal: agg?.dailyCreditTotal ?? 0,
    totalWithdrawals: agg?.totalWithdrawals ?? 0,
    totalAdjustments: agg?.totalAdjustments ?? 0,
    netChange:        agg?.netChange ?? 0,
    currentBalance,
  }
}

// ── getEmployeeWalletOverview ────────────────────────────────
// Phase 2.3, extended Phase 2.5 (allowancePaymentPeriod). Service-level
// only — no dedicated route.
export const getEmployeeWalletOverview = async (tenantId, employeeId) => {
  const employee = await Employee.findOne({
    _id:      new mongoose.Types.ObjectId(employeeId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })
    .populate('outletId', 'name')
    .lean()

  if (!employee) {
    throw new ApiError(404, 'Employee not found')
  }

  const currentBalance = await getCurrentBalance(tenantId, employeeId)

  return {
    employeeId:             employee._id,
    employeeName:           employee.name,
    outletId:               employee.outletId?._id ?? null,
    outletName:             employee.outletId?.name ?? null,
    isActive:               employee.isActive,
    dailyAllowanceAmount:   employee.dailyAllowanceAmount ?? 25000,
    allowancePaymentPeriod: employee.allowancePaymentPeriod ?? 'daily',
    currentBalance,
  }
}

// ── listLedgerHistory ────────────────────────────────────────

export const listLedgerHistory = async (tenantId, employeeId, queryParams = {}) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = {
    tenantId:   new mongoose.Types.ObjectId(tenantId),
    employeeId: new mongoose.Types.ObjectId(employeeId),
  }

  if (queryParams.type) {
    filter.type = queryParams.type
  }

  if (queryParams.startDate || queryParams.endDate) {
    filter.date = {}
    if (queryParams.startDate) filter.date.$gte = toMidnightUTC(queryParams.startDate)
    if (queryParams.endDate)   filter.date.$lte = toMidnightUTC(queryParams.endDate)
  }

  const [entries, total] = await Promise.all([
    EmployeeWalletLedger.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EmployeeWalletLedger.countDocuments(filter),
  ])

  return {
    entries,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}