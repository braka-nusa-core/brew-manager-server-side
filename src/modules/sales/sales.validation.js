// ============================================================
// modules/sales/sales.validation.js
// Pure validation functions for sales operations.
// No Express dependency — independently testable.
// ============================================================

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

// ── validateCreateSale ────────────────────────────────────────

/**
 * Validates the request body for creating a sale record.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateSale = (body) => {
  const errors = []
  const { employeeId, date, totalCups, totalRevenue, notes } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (totalCups === undefined || totalCups === null) {
    errors.push('totalCups is required')
  } else if (typeof totalCups !== 'number' || isNaN(totalCups)) {
    errors.push('totalCups must be a number')
  } else if (totalCups < 0) {
    errors.push('totalCups cannot be negative')
  }

  if (totalRevenue === undefined || totalRevenue === null) {
    errors.push('totalRevenue is required')
  } else if (typeof totalRevenue !== 'number' || isNaN(totalRevenue)) {
    errors.push('totalRevenue must be a number')
  } else if (totalRevenue < 0) {
    errors.push('totalRevenue cannot be negative')
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateSale ────────────────────────────────────────

/**
 * Validates the request body for updating a sale record.
 * All fields are optional — only provided fields are validated.
 * tenantId, outletId, employeeId are immutable.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateSale = (body) => {
  const errors = []
  const { tenantId, outletId, employeeId, date, totalCups, totalRevenue, notes } = body

  // Guard immutable fields
  if (tenantId    !== undefined) errors.push('tenantId cannot be changed')
  if (outletId    !== undefined) errors.push('outletId cannot be changed')
  if (employeeId  !== undefined) errors.push('employeeId cannot be changed')

  // Ensure at least one mutable field is provided
  const hasMutableField = [date, totalCups, totalRevenue, notes].some(
    (v) => v !== undefined
  )
  if (!hasMutableField) {
    errors.push('At least one field (date, totalCups, totalRevenue, notes) must be provided')
  }

  if (date !== undefined && !isValidDate(date)) {
    errors.push('date must be a valid date string')
  }

  if (totalCups !== undefined) {
    if (typeof totalCups !== 'number' || isNaN(totalCups)) {
      errors.push('totalCups must be a number')
    } else if (totalCups < 0) {
      errors.push('totalCups cannot be negative')
    }
  }

  if (totalRevenue !== undefined) {
    if (typeof totalRevenue !== 'number' || isNaN(totalRevenue)) {
      errors.push('totalRevenue must be a number')
    } else if (totalRevenue < 0) {
      errors.push('totalRevenue cannot be negative')
    }
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  return { isValid: errors.length === 0, errors }
}
