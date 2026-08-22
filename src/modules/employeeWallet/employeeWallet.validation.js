// ============================================================
// modules/employeeWallet/employeeWallet.validation.js
// Phase 2.1 — Employee Wallet foundation.
// Phase 2.1 refinement pass:
//   - validateEmployeeIdQuery() added for the new query-param-based
//     GET /wallet/balance and GET /wallet/history endpoints.
//   - validateLedgerEntryShape() added: a generic validator covering
//     ALL WALLET_TRANSACTION_TYPES (including manual_credit,
//     manual_debit, migration — not yet exposed via any route), so
//     Phase 2.2 can wire a new endpoint straight onto an already-tested
//     validator instead of writing one from scratch. Not used by any
//     route yet itself — validateCreateWithdrawal/validateCreateAdjustment
//     below (which ARE wired to routes) both build on it, and a future
//     manual_credit/manual_debit/migration endpoint can do the same.
// ============================================================

import { WALLET_TRANSACTION_TYPES } from '../../models/EmployeeWalletLedger.model.js'

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

// ── validateEmployeeIdQuery ─────────────────────────────────
// Used by GET /wallet/balance and GET /wallet/history, which now take
// employeeId as a query param (?employeeId=...) instead of a route
// param — so it needs its own check; validateObjectId middleware only
// validates req.params, not req.query.

export const validateEmployeeIdQuery = (query) => {
  const errors = []
  const { employeeId } = query

  if (!employeeId) {
    errors.push('employeeId query parameter is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateLedgerEntryShape ─────────────────────────────────
// Generic shape check for ANY wallet ledger entry, across the full
// WALLET_TRANSACTION_TYPES enum. Ready for future transaction types
// (manual_credit, manual_debit, migration) even though no route
// exposes them yet in this phase — a future endpoint can call this
// directly instead of duplicating the same field checks.
//
// Intentionally does NOT enforce type-specific rules (e.g. "withdrawal
// amount must be positive", "adjustment requires notes") — those stay
// in the type-specific validators below / in the service layer, since
// they differ per type. This only checks the shape every ledger entry
// must satisfy regardless of type.

export const validateLedgerEntryShape = (body) => {
  const errors = []
  const { employeeId, type, amount, date, notes } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (!type) {
    errors.push('type is required')
  } else if (!WALLET_TRANSACTION_TYPES.includes(type)) {
    errors.push(`type must be one of: ${WALLET_TRANSACTION_TYPES.join(', ')}`)
  }

  if (amount === undefined || amount === null) {
    errors.push('amount is required')
  } else if (typeof amount !== 'number' || isNaN(amount) || amount === 0) {
    errors.push('amount must be a non-zero number')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateCreateWithdrawal ────────────────────────────────
// POST /wallet/withdrawal — employeeId comes from the request body
// (routes are no longer per-employeeId path params).

export const validateCreateWithdrawal = (body) => {
  const errors = []
  const { employeeId, amount, date, notes } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (amount === undefined || amount === null) {
    errors.push('amount is required')
  } else if (typeof amount !== 'number' || isNaN(amount)) {
    errors.push('amount must be a number')
  } else if (amount <= 0) {
    errors.push('amount must be a positive number (the amount being withdrawn)')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateCreateAdjustment ─────────────────────────────────
// POST /wallet/adjustment — employeeId comes from the request body.

export const validateCreateAdjustment = (body) => {
  const errors = []
  const { employeeId, amount, date, notes } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (amount === undefined || amount === null) {
    errors.push('amount is required')
  } else if (typeof amount !== 'number' || isNaN(amount)) {
    errors.push('amount must be a number')
  } else if (amount === 0) {
    errors.push('amount must not be zero')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (!notes || typeof notes !== 'string' || !notes.trim()) {
    errors.push('notes is required for an adjustment (explain the correction)')
  }

  return { isValid: errors.length === 0, errors }
}