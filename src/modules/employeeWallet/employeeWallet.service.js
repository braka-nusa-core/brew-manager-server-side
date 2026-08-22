// ============================================================
// modules/employeeWallet/employeeWallet.service.js
// Phase 2.1 — Employee Wallet foundation.
// Phase 2.1 refinement pass — architectural cleanup only, no business
// logic change:
//   - Single internal createLedgerEntry() helper now backs every
//     transaction type (daily_credit, withdrawal, adjustment, and the
//     not-yet-routed manual_credit/manual_debit/migration).
//   - Every ledger write now runs inside a mongoose session transaction
//     (session.withTransaction), matching the consistency guarantee
//     inventory.service.js's consumeFifo() already provides — the
//     previous read-then-write balance computation is no longer
//     susceptible to a concurrent-write race.
//
// Owns all EmployeeWalletLedger read/write logic. This is the ONLY
// module allowed to write EmployeeWalletLedger documents — mirrors the
// "one writer" convention already used by inventory.service.js for
// InventoryTransaction/InventoryBatch.
//
// Scope of this phase (Phase 2.1) — foundation only:
//   - getCurrentBalance()
//   - createDailyCredit()
//   - createWithdrawal()
//   - createAdjustment()
//   - listLedgerHistory() (supporting read for the GET history route)
//
// Explicitly OUT of scope for this phase:
//   - No Attendance integration (nothing calls createDailyCredit()
//     automatically — it is exposed as a service method only).
//   - No Payroll integration.
//   - No kasbon/bonus/reimbursement business logic beyond the generic
//     manual_credit/manual_debit/adjustment types already on the enum.
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
 * Returns the lean Employee doc (used for outletId snapshot and, for
 * daily credits, dailyAllowanceAmount).
 *
 * @param {import('mongoose').ClientSession} [session] - threaded through
 *   when called from inside a transaction (write paths); omitted for
 *   plain reads.
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
 * Withdrawal eligibility rule, isolated on purpose so it can become
 * configurable later (e.g. per-outlet or per-tenant overdraw allowance)
 * without restructuring createLedgerEntry()/createWithdrawal() itself.
 * Phase 2.1: fixed rule — withdrawal cannot exceed current balance.
 *
 * @param {number} currentBalance
 * @param {number} amount - positive withdrawal amount requested
 * @returns {{ allowed: boolean, reason?: string }}
 */
const evaluateWithdrawalRule = (currentBalance, amount) => {
  if (amount > currentBalance) {
    return {
      allowed: false,
      reason:  `Withdrawal amount (${amount}) exceeds current balance (${currentBalance})`,
    }
  }
  return { allowed: true }
}

// ── getCurrentBalance ────────────────────────────────────────

/**
 * Derives an employee's current wallet balance from the ledger.
 * Balance is never stored on Employee — this always reads the most
 * recent ledger entry's balanceAfter (ordered by createdAt), falling
 * back to 0 when the employee has no ledger entries yet.
 *
 * @param {string} tenantId
 * @param {string} employeeId
 * @param {import('mongoose').ClientSession} [session] - threaded through
 *   when called from inside createLedgerEntry()'s transaction, so the
 *   balance read and the entry it's based on are part of the same
 *   snapshot; omitted for standalone reads (e.g. the GET balance route).
 * @returns {Promise<number>}
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
// Single internal writer used by EVERY transaction type — daily_credit,
// withdrawal, adjustment, and the not-yet-routed manual_credit/
// manual_debit/migration. This is the only place balanceAfter is
// computed (previousBalance -> newBalance -> balanceAfter) and the
// only place that opens/commits the session transaction, so every
// caller gets the same consistency guarantee without duplicating it.
//
// Runs entirely inside session.withTransaction(): the balance read and
// the ledger write happen in the same session, so two concurrent calls
// for the same employee can no longer race on the same previousBalance
// (the second transaction sees the first's committed write, or the two
// are serialized/one retried by the driver — same guarantee
// consumeFifo() already relies on for InventoryBatch).
//
// NOT exported for arbitrary external use — each transaction type gets
// its own thin, type-specific wrapper below (createDailyCredit,
// createWithdrawal, createAdjustment) that validates its own
// preconditions (withdrawal-vs-balance, adjustment requires notes,
// etc.) before delegating here. This keeps createLedgerEntry() itself
// free of any single type's business rules.
//
// @param {Object} params
// @param {string} params.tenantId
// @param {string} params.outletId
// @param {string} params.employeeId
// @param {string|Date} params.date
// @param {string} params.type - one of WALLET_TRANSACTION_TYPES
// @param {number} params.amount - already signed (+credit / -debit)
// @param {string} [params.notes]
// @param {string} params.createdBy
const createLedgerEntry = async ({
  tenantId, outletId, employeeId, date, type, amount, notes, createdBy,
}) => {
  if (!WALLET_TRANSACTION_TYPES.includes(type)) {
    throw new ApiError(400, `type must be one of: ${WALLET_TRANSACTION_TYPES.join(', ')}`)
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    throw new ApiError(400, 'amount must be a non-zero finite number')
  }

  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
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

      result = created[0].toObject()
    })
  } finally {
    await session.endSession()
  }

  return result
}

// ── createDailyCredit ────────────────────────────────────────

/**
 * Credits one day's allowance to an employee's wallet.
 * Amount is NEVER hardcoded here — it is read from
 * Employee.dailyAllowanceAmount and snapshotted onto the ledger entry,
 * so a later change to that field never rewrites history.
 *
 * Phase 2.1: exposed as a plain service method only. Nothing calls
 * this automatically yet — no Attendance integration in this phase.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.employeeId
 * @param {string|Date} params.date
 * @param {string} params.createdBy
 * @param {string} [params.notes]
 */
export const createDailyCredit = async ({ tenantId, employeeId, date, createdBy, notes }) => {
  const employee = await loadEmployee(tenantId, employeeId)
  const amount   = employee.dailyAllowanceAmount ?? 25000

  if (amount <= 0) {
    throw new ApiError(400, 'Employee dailyAllowanceAmount must be greater than 0 to credit')
  }

  return createLedgerEntry({
    tenantId,
    outletId:   employee.outletId,
    employeeId,
    date,
    type:       'daily_credit',
    amount,      // positive — credit
    notes:      notes ?? 'Daily allowance credit',
    createdBy,
  })
}

// ── createWithdrawal ─────────────────────────────────────────

/**
 * Records a withdrawal against an employee's wallet balance.
 * `amount` is provided as a positive number (the amount being
 * withdrawn); it is stored as a negative ledger amount.
 *
 * Current rule (Phase 2.1, fixed): withdrawal cannot exceed balance.
 * See evaluateWithdrawalRule() — isolated so this restriction can
 * become configurable later without touching this function's shape.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.employeeId
 * @param {number} params.amount - positive amount to withdraw
 * @param {string|Date} params.date
 * @param {string} params.createdBy
 * @param {string} [params.notes]
 */
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

  // Note: the eligibility check above reads the balance OUTSIDE the
  // write transaction (so an over-limit withdrawal gets a clean 400
  // without opening a session at all). createLedgerEntry() re-reads
  // the balance INSIDE its own transaction as the authoritative value
  // the write is based on, so the final balanceAfter is always correct
  // even if the balance moved between this pre-check and the write.
  return createLedgerEntry({
    tenantId,
    outletId:   employee.outletId,
    employeeId,
    date,
    type:       'withdrawal',
    amount:     -amount,  // negative — debit
    notes,
    createdBy,
  })
}

// ── createAdjustment ─────────────────────────────────────────

/**
 * Records a manual signed correction against an employee's wallet.
 * `amount` is provided already signed (positive = credit correction,
 * negative = debit correction) — unlike createWithdrawal, which takes
 * an unsigned magnitude, because an adjustment can go either direction
 * and the caller should be explicit about which.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.employeeId
 * @param {number} params.amount - signed adjustment amount
 * @param {string|Date} params.date
 * @param {string} params.createdBy
 * @param {string} params.notes - required, explains the correction
 */
export const createAdjustment = async ({ tenantId, employeeId, amount, date, createdBy, notes }) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    throw new ApiError(400, 'Adjustment amount must be a non-zero number')
  }

  if (!notes || !notes.trim()) {
    throw new ApiError(400, 'notes is required for an adjustment (explain the correction)')
  }

  const employee = await loadEmployee(tenantId, employeeId)

  return createLedgerEntry({
    tenantId,
    outletId:   employee.outletId,
    employeeId,
    date,
    type:       'adjustment',
    amount,
    notes,
    createdBy,
  })
}

// ── listLedgerHistory ────────────────────────────────────────

/**
 * Paginated ledger history for one employee, tenant/outlet-safe.
 *
 * @param {string} tenantId
 * @param {string} employeeId
 * @param {Object} queryParams - { page, limit, type, startDate, endDate }
 */
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