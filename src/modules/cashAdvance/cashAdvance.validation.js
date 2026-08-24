// ============================================================
// modules/cashAdvance/cashAdvance.validation.js
// Pure validation functions for Cash Advance operations.
// ============================================================

import { CASH_ADVANCE_STATUSES } from '../../models/CashAdvance.model.js'

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

// ── validateCreateCashAdvance ────────────────────────────────

export const validateCreateCashAdvance = (body) => {
  const errors = []
  const { employeeId, amount, date, notes } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (amount === undefined || amount === null) {
    errors.push('amount is required')
  } else if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    errors.push('amount must be a number')
  } else if (amount <= 0) {
    errors.push('amount must be greater than 0')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (!notes || typeof notes !== 'string' || !notes.trim()) {
    errors.push('notes is required and must explain the purpose of the advance')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateListQuery ─────────────────────────────────────────

export const validateListQuery = (query) => {
  const errors = []
  const { employeeId, status, outletId, startDate, endDate } = query

  if (employeeId !== undefined && !isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (outletId !== undefined && !isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  if (status !== undefined && !CASH_ADVANCE_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${CASH_ADVANCE_STATUSES.join(', ')}`)
  }

  if (startDate !== undefined && !isValidDate(startDate)) {
    errors.push('startDate must be a valid date string (e.g. 2026-05-18)')
  }

  if (endDate !== undefined && !isValidDate(endDate)) {
    errors.push('endDate must be a valid date string (e.g. 2026-05-18)')
  }

  return { isValid: errors.length === 0, errors }
}