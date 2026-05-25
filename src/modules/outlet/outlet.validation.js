// ============================================================
// modules/outlet/outlet.validation.js
// Pure validation for outlet operations.
// No Express dependency — independently testable.
// ============================================================

// ── validateCreateOutlet ──────────────────────────────────────

/**
 * Validates request body for creating an outlet.
 * tenantId is NEVER validated here — it comes from req.tenantId (JWT).
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateOutlet = (body) => {
  const errors = []
  const { name, code, address, phone } = body

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  if (code !== undefined) {
    if (typeof code !== 'string' || code.trim().length < 2 || code.trim().length > 10) {
      errors.push('code must be between 2 and 10 characters')
    }
  }

  if (address !== undefined && address !== null && typeof address !== 'string') {
    errors.push('address must be a string')
  }

  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateOutlet ──────────────────────────────────────

/**
 * Validates request body for updating an outlet.
 * All fields optional. tenantId immutable.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateOutlet = (body) => {
  const errors = []
  const { tenantId, name, code, address, phone, isActive } = body

  // Guard immutable field
  if (tenantId !== undefined) {
    errors.push('tenantId cannot be changed')
  }

  // At least one field required
  const mutableFields = [name, code, address, phone, isActive]
  if (mutableFields.every((v) => v === undefined)) {
    errors.push('At least one field must be provided to update')
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  if (code !== undefined) {
    if (typeof code !== 'string' || code.trim().length < 2 || code.trim().length > 10) {
      errors.push('code must be between 2 and 10 characters')
    }
  }

  if (address !== undefined && address !== null && typeof address !== 'string') {
    errors.push('address must be a string')
  }

  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean')
  }

  return { isValid: errors.length === 0, errors }
}