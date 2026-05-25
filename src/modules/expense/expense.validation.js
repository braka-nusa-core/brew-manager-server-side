// ============================================================
// modules/expense/expense.validation.js
// Pure validation functions for expense operations.
// No Express dependency — independently testable.
// ============================================================

import { EXPENSE_CATEGORIES } from '../../models/Expense.model.js'

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

// ── validateCreateExpense ─────────────────────────────────────

/**
 * Validates request body for creating an expense.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateExpense = (body) => {
  const errors = []
  const { outletId, date, category, description, amount } = body

  if (!outletId) {
    errors.push('outletId is required')
  } else if (!isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (!category) {
    errors.push('category is required')
  } else if (!EXPENSE_CATEGORIES.includes(category)) {
    errors.push(`category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`)
  }

  if (!description || typeof description !== 'string' || description.trim().length < 2) {
    errors.push('description is required and must be at least 2 characters')
  } else if (description.trim().length > 255) {
    errors.push('description must not exceed 255 characters')
  }

  if (amount === undefined || amount === null) {
    errors.push('amount is required')
  } else if (typeof amount !== 'number' || isNaN(amount)) {
    errors.push('amount must be a number')
  } else if (amount < 0) {
    errors.push('amount cannot be negative')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateExpense ─────────────────────────────────────

/**
 * Validates request body for updating an expense.
 * All fields are optional — only provided fields are validated.
 * tenantId and outletId are immutable.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateExpense = (body) => {
  const errors = []
  const { tenantId, outletId, date, category, description, amount } = body

  // Guard immutable fields
  if (tenantId !== undefined) errors.push('tenantId cannot be changed')
  if (outletId !== undefined) errors.push('outletId cannot be changed')

  // At least one mutable field required
  const hasMutableField = [date, category, description, amount].some(
    (v) => v !== undefined
  )
  if (!hasMutableField) {
    errors.push(
      'At least one field (date, category, description, amount) must be provided'
    )
  }

  if (date !== undefined && !isValidDate(date)) {
    errors.push('date must be a valid date string')
  }

  if (category !== undefined && !EXPENSE_CATEGORIES.includes(category)) {
    errors.push(`category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`)
  }

  if (description !== undefined) {
    if (typeof description !== 'string' || description.trim().length < 2) {
      errors.push('description must be at least 2 characters')
    } else if (description.trim().length > 255) {
      errors.push('description must not exceed 255 characters')
    }
  }

  if (amount !== undefined) {
    if (typeof amount !== 'number' || isNaN(amount)) {
      errors.push('amount must be a number')
    } else if (amount < 0) {
      errors.push('amount cannot be negative')
    }
  }

  return { isValid: errors.length === 0, errors }
}
