// ============================================================
// modules/employeeWallet/employeeWallet.validation.js
// Phase 2.1 — Employee Wallet foundation.
// Phase 2.3 — read/reporting endpoints:
//   - validateHistoryQuery() / validateSummaryQuery() added.
// Phase 2.4 — validateManualEntry() added.
// ============================================================

import { WALLET_TRANSACTION_TYPES } from '../../models/EmployeeWalletLedger.model.js'

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

// ── validateEmployeeIdQuery ─────────────────────────────────
// Used by GET /wallet/balance, which only ever needs employeeId.

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

// ── validateDateRangeQuery ───────────────────────────────────

const validateDateRangeQuery = (query, errors) => {
  const { startDate, endDate } = query

  if (startDate !== undefined && !isValidDate(startDate)) {
    errors.push('startDate must be a valid date string (e.g. 2026-05-18)')
  }

  if (endDate !== undefined && !isValidDate(endDate)) {
    errors.push('endDate must be a valid date string (e.g. 2026-05-18)')
  }

  if (
    startDate !== undefined && endDate !== undefined &&
    isValidDate(startDate) && isValidDate(endDate) &&
    new Date(startDate) > new Date(endDate)
  ) {
    errors.push('startDate must not be after endDate')
  }
}

// ── validateHistoryQuery ─────────────────────────────────────
// GET /wallet/history — employeeId (required) + optional type/startDate/endDate.

export const validateHistoryQuery = (query) => {
  const errors = []
  const { employeeId, type } = query

  if (!employeeId) {
    errors.push('employeeId query parameter is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (type !== undefined && !WALLET_TRANSACTION_TYPES.includes(type)) {
    errors.push(`type must be one of: ${WALLET_TRANSACTION_TYPES.join(', ')}`)
  }

  validateDateRangeQuery(query, errors)

  return { isValid: errors.length === 0, errors }
}

// ── validateSummaryQuery ──────────────────────────────────────
// GET /wallet/summary — employeeId (required) + optional startDate/endDate.

export const validateSummaryQuery = (query) => {
  const errors = []
  const { employeeId } = query

  if (!employeeId) {
    errors.push('employeeId query parameter is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  validateDateRangeQuery(query, errors)

  return { isValid: errors.length === 0, errors }
}

// ── validateLedgerEntryShape ─────────────────────────────────
// Generic shape check across the full WALLET_TRANSACTION_TYPES enum.

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

// ── validateManualEntry ───────────────────────────────────────
// Phase 2.4 — POST /wallet/manual. amount is always POSITIVE for both
// manual_credit and manual_debit — sign conversion happens in the
// service layer.

export const validateManualEntry = (body) => {
  const errors = []
  const { employeeId, type, amount, date, notes } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (!type) {
    errors.push('type is required')
  } else if (type !== 'manual_credit' && type !== 'manual_debit') {
    errors.push('type must be one of: manual_credit, manual_debit')
  }

  if (amount === undefined || amount === null) {
    errors.push('amount is required')
  } else if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount)) {
    errors.push('amount must be a finite number')
  } else if (amount <= 0) {
    errors.push('amount must be a positive number')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (!notes || typeof notes !== 'string' || !notes.trim()) {
    errors.push('notes is required for a manual wallet transaction (explain the reason)')
  }

  return { isValid: errors.length === 0, errors }
}