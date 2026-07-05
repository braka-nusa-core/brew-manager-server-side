// ============================================================
// modules/user/user.validation.js
// Pure validation functions for the User Management module.
// No Express dependency — functions receive plain objects and
// return { isValid, errors } consistent with every other
// validation file in this project.
//
// Sprint 1 — User Management
// ============================================================

import mongoose from 'mongoose'

// Roles that can be created through the user management API.
// tenant_admin and super_admin are intentionally excluded:
//   - tenant_admin is created only at bootstrap
//   - super_admin is created manually in the database
const CREATABLE_ROLES = ['manager', 'cashier', 'viewer']

// Roles that require an outletId (outlet-scoped)
const OUTLET_SCOPED_ROLES = ['manager', 'cashier', 'viewer']

// Email regex — same pattern as User.model.js
const EMAIL_REGEX = /^\S+@\S+\.\S+$/

// ObjectId validator helper
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value)

// ── validateCreateUser ────────────────────────────────────────

/**
 * Validates the body of POST /api/v1/users.
 *
 * Rules:
 *   - name:     required, 2–100 chars
 *   - email:    required, valid email format
 *   - password: required, min 8 characters
 *   - role:     required, must be one of CREATABLE_ROLES
 *   - outletId: required when role is manager, cashier, or viewer
 *               must be absent/null when role is not outlet-scoped
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateUser = (body) => {
  const errors = []
  const { name, email, password, role, outletId } = body

  // name
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  // email
  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.push('email is required and must be a valid email address')
  }

  // password
  if (!password || typeof password !== 'string') {
    errors.push('password is required')
  } else if (password.length < 8) {
    errors.push('password must be at least 8 characters')
  }

  // role
  if (!role || typeof role !== 'string') {
    errors.push('role is required')
  } else if (!CREATABLE_ROLES.includes(role)) {
    errors.push(`role must be one of: ${CREATABLE_ROLES.join(', ')}`)
  }

  // outletId — required for all creatable roles (all are outlet-scoped)
  if (OUTLET_SCOPED_ROLES.includes(role)) {
    if (!outletId) {
      errors.push('outletId is required for this role')
    } else if (!isValidObjectId(outletId)) {
      errors.push('outletId must be a valid MongoDB ObjectId')
    }
  } else if (outletId !== undefined && outletId !== null) {
    // Non-outlet-scoped role (none in CREATABLE_ROLES currently, but defensive)
    errors.push('outletId must not be provided for this role')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateUser ────────────────────────────────────────

/**
 * Validates the body of PATCH /api/v1/users/:userId.
 *
 * Rules:
 *   - At least one mutable field required
 *   - name:     optional, 2–100 chars
 *   - email:    optional, valid email format
 *   - outletId: optional, valid ObjectId or null
 *   - role:     FORBIDDEN — role changes are not allowed via update
 *   - password: FORBIDDEN — use reset-password endpoint instead
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateUser = (body) => {
  const errors = []
  const { name, email, outletId, role, password } = body

  // Guard forbidden fields — these must never be changed via PATCH
  if (role !== undefined) {
    errors.push('role cannot be changed via this endpoint')
  }

  if (password !== undefined) {
    errors.push('password cannot be changed via this endpoint — use reset-password')
  }

  // At least one mutable field must be present
  const mutableFields = [name, email, outletId]
  if (mutableFields.every((v) => v === undefined)) {
    errors.push('At least one field must be provided to update (name, email, outletId)')
  }

  // name
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  // email
  if (email !== undefined) {
    if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      errors.push('email must be a valid email address')
    }
  }

  // outletId — can be a valid ObjectId or explicit null
  if (outletId !== undefined && outletId !== null) {
    if (!isValidObjectId(outletId)) {
      errors.push('outletId must be a valid MongoDB ObjectId or null')
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateResetPassword ─────────────────────────────────────

/**
 * Validates the body of PATCH /api/v1/users/:userId/reset-password.
 * Admin action — only newPassword is required (no currentPassword check).
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateResetPassword = (body) => {
  const errors = []
  const { newPassword } = body

  if (!newPassword || typeof newPassword !== 'string') {
    errors.push('newPassword is required')
  } else if (newPassword.length < 8) {
    errors.push('newPassword must be at least 8 characters')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateChangePassword ────────────────────────────────────

/**
 * Validates the body of PATCH /api/v1/auth/change-password.
 * Self-service action — currentPassword is required for verification.
 * The check that newPassword !== currentPassword is handled in the
 * service layer (business logic, not input validation).
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateChangePassword = (body) => {
  const errors = []
  const { currentPassword, newPassword } = body

  if (!currentPassword || typeof currentPassword !== 'string') {
    errors.push('currentPassword is required')
  }

  if (!newPassword || typeof newPassword !== 'string') {
    errors.push('newPassword is required')
  } else if (newPassword.length < 8) {
    errors.push('newPassword must be at least 8 characters')
  }

  return { isValid: errors.length === 0, errors }
}