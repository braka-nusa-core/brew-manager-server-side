// ============================================================
// modules/employee/employee.validation.js
// Input validation for employee create and update operations.
//
// Design decisions:
//   - Validation is pure functions returning { isValid, errors }.
//   - No dependency on express-validator — keeps validation
//     portable and independently testable.
//   - Controllers call these before invoking the service.
//   - ObjectId validation uses a simple regex — Mongoose will
//     also catch invalid IDs, but early validation gives cleaner errors.
//   - Update validation uses partial rules — only provided
//     fields are validated; missing fields are not flagged.
// ============================================================

import mongoose from 'mongoose'

const SALARY_TYPES  = ['monthly', 'daily']
const OBJECT_ID_RE  = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

// ── createEmployee ───────────────────────────────────────────

/**
 * Validates the request body for creating a new employee.
 * All required fields are checked. outletId from body is
 * validated here but NEVER trusted for tenant scope —
 * that is enforced in the service via tenantGuard context.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateEmployee = (body) => {
  const errors = []
  const {
    outletId,
    name,
    phone,
    position,
    salaryType,
    baseSalary,
    joinDate,
  } = body

  // outletId
  if (!outletId) {
    errors.push('outletId is required')
  } else if (!isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  // name
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  // phone (optional)
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  // position
  if (!position || typeof position !== 'string' || position.trim().length < 2) {
    errors.push('position is required and must be at least 2 characters')
  } else if (position.trim().length > 50) {
    errors.push('position must not exceed 50 characters')
  }

  // salaryType
  if (!salaryType) {
    errors.push('salaryType is required')
  } else if (!SALARY_TYPES.includes(salaryType)) {
    errors.push(`salaryType must be one of: ${SALARY_TYPES.join(', ')}`)
  }

  // baseSalary
  if (baseSalary === undefined || baseSalary === null) {
    errors.push('baseSalary is required')
  } else if (typeof baseSalary !== 'number' || isNaN(baseSalary)) {
    errors.push('baseSalary must be a number')
  } else if (baseSalary < 0) {
    errors.push('baseSalary cannot be negative')
  }

  // joinDate
  if (!joinDate) {
    errors.push('joinDate is required')
  } else if (isNaN(Date.parse(joinDate))) {
    errors.push('joinDate must be a valid date')
  }

  return { isValid: errors.length === 0, errors }
}

// ── updateEmployee ───────────────────────────────────────────

/**
 * Validates the request body for updating an employee.
 * All fields are optional — only provided fields are validated.
 * tenantId and outletId cannot be changed via update — those
 * are rejected if present.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateEmployee = (body) => {
  const errors = []
  const {
    tenantId,
    outletId,
    name,
    phone,
    position,
    salaryType,
    baseSalary,
    joinDate,
    isActive,
  } = body

  // Guard: tenantId and outletId are immutable via this endpoint
  if (tenantId !== undefined) {
    errors.push('tenantId cannot be changed')
  }

  // outletId CAN be updated (outlet reassignment) — validate if provided
  if (outletId !== undefined) {
    if (!isValidObjectId(outletId)) {
      errors.push('outletId must be a valid ObjectId')
    }
  }

  // name
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  // phone
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  // position
  if (position !== undefined) {
    if (typeof position !== 'string' || position.trim().length < 2) {
      errors.push('position must be at least 2 characters')
    } else if (position.trim().length > 50) {
      errors.push('position must not exceed 50 characters')
    }
  }

  // salaryType
  if (salaryType !== undefined && !SALARY_TYPES.includes(salaryType)) {
    errors.push(`salaryType must be one of: ${SALARY_TYPES.join(', ')}`)
  }

  // baseSalary
  if (baseSalary !== undefined) {
    if (typeof baseSalary !== 'number' || isNaN(baseSalary)) {
      errors.push('baseSalary must be a number')
    } else if (baseSalary < 0) {
      errors.push('baseSalary cannot be negative')
    }
  }

  // joinDate
  if (joinDate !== undefined && isNaN(Date.parse(joinDate))) {
    errors.push('joinDate must be a valid date')
  }

  // isActive — not validated here; toggle-active endpoint handles this
  if (isActive !== undefined) {
    errors.push('Use the /toggle-active endpoint to change active status')
  }

  return { isValid: errors.length === 0, errors }
}
