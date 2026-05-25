// ============================================================
// modules/payroll/payroll.validation.js
// Pure validation functions for payroll operations.
// No Express dependency — independently testable.
// ============================================================

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

// ── validateGeneratePayroll ───────────────────────────────────

/**
 * Validates the request body for generating payroll.
 *
 * outletId:    which outlet's employees to generate payroll for
 * month:       1–12
 * year:        4-digit integer
 * workingDays: actual working days in this period
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateGeneratePayroll = (body) => {
  const errors = []
  const { outletId, month, year, workingDays } = body

  if (!outletId) {
    errors.push('outletId is required')
  } else if (!isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  if (month === undefined || month === null) {
    errors.push('month is required')
  } else {
    const m = Number(month)
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      errors.push('month must be an integer between 1 and 12')
    }
  }

  if (year === undefined || year === null) {
    errors.push('year is required')
  } else {
    const y = Number(year)
    if (!Number.isInteger(y) || y < 2000) {
      errors.push('year must be an integer of 2000 or later')
    }
  }

  if (workingDays === undefined || workingDays === null) {
    errors.push('workingDays is required')
  } else {
    const w = Number(workingDays)
    if (!Number.isInteger(w) || w < 1) {
      errors.push('workingDays must be a positive integer')
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateAdjustPayroll ─────────────────────────────────────

/**
 * Validates the request body for adjusting a payroll record.
 * At least one of manualBonus or deductions must be provided.
 * Both are optional individually but at least one is required.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateAdjustPayroll = (body) => {
  const errors = []
  const { manualBonus, deductions } = body

  if (manualBonus === undefined && deductions === undefined) {
    errors.push('At least one of manualBonus or deductions must be provided')
  }

  if (manualBonus !== undefined) {
    if (typeof manualBonus !== 'number' || isNaN(manualBonus)) {
      errors.push('manualBonus must be a number')
    } else if (manualBonus < 0) {
      errors.push('manualBonus cannot be negative')
    }
  }

  if (deductions !== undefined) {
    if (typeof deductions !== 'number' || isNaN(deductions)) {
      errors.push('deductions must be a number')
    } else if (deductions < 0) {
      errors.push('deductions cannot be negative')
    }
  }

  return { isValid: errors.length === 0, errors }
}
