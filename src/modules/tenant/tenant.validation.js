// ============================================================
// modules/tenant/tenant.validation.js
// Pure validation for tenant operations.
// No Express dependency — independently testable.
// ============================================================

import { TENANT_PLANS } from '../../models/Tenant.model.js'

const SLUG_RE  = /^[a-z0-9-]+$/
const EMAIL_RE = /^\S+@\S+\.\S+$/

// ── validateBootstrap ─────────────────────────────────────────

/**
 * Validates the full bootstrap payload:
 *   tenant: { name, slug?, plan? }
 *   adminUser: { name, email, password }
 *   outlet: { name, code?, address?, phone? }
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateBootstrap = (body) => {
  const errors = []
  const { tenant, adminUser, outlet } = body

  // ── Tenant ────────────────────────────────────────────────

  if (!tenant || typeof tenant !== 'object') {
    errors.push('tenant object is required')
  } else {
    if (!tenant.name || typeof tenant.name !== 'string' || tenant.name.trim().length < 2) {
      errors.push('tenant.name is required and must be at least 2 characters')
    } else if (tenant.name.trim().length > 100) {
      errors.push('tenant.name must not exceed 100 characters')
    }

    if (tenant.slug !== undefined) {
      if (typeof tenant.slug !== 'string' || !SLUG_RE.test(tenant.slug.trim())) {
        errors.push('tenant.slug may only contain lowercase letters, numbers, and hyphens')
      } else if (tenant.slug.trim().length < 2 || tenant.slug.trim().length > 60) {
        errors.push('tenant.slug must be between 2 and 60 characters')
      }
    }

    if (tenant.plan !== undefined && !TENANT_PLANS.includes(tenant.plan)) {
      errors.push(`tenant.plan must be one of: ${TENANT_PLANS.join(', ')}`)
    }
  }

  // ── Admin User ────────────────────────────────────────────

  if (!adminUser || typeof adminUser !== 'object') {
    errors.push('adminUser object is required')
  } else {
    if (!adminUser.name || typeof adminUser.name !== 'string' || adminUser.name.trim().length < 2) {
      errors.push('adminUser.name is required and must be at least 2 characters')
    }

    if (!adminUser.email || !EMAIL_RE.test(adminUser.email)) {
      errors.push('adminUser.email must be a valid email address')
    }

    if (!adminUser.password || typeof adminUser.password !== 'string' || adminUser.password.length < 8) {
      errors.push('adminUser.password is required and must be at least 8 characters')
    }
  }

  // ── Outlet ────────────────────────────────────────────────

  if (!outlet || typeof outlet !== 'object') {
    errors.push('outlet object is required')
  } else {
    if (!outlet.name || typeof outlet.name !== 'string' || outlet.name.trim().length < 2) {
      errors.push('outlet.name is required and must be at least 2 characters')
    }

    if (outlet.code !== undefined) {
      if (typeof outlet.code !== 'string' || outlet.code.trim().length < 2 || outlet.code.trim().length > 10) {
        errors.push('outlet.code must be between 2 and 10 characters')
      }
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateCreateTenant ──────────────────────────────────────

/**
 * Validates a super_admin creating a tenant directly (no bootstrap).
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateTenant = (body) => {
  const errors = []
  const { name, slug, plan } = body

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  if (slug !== undefined) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug.trim())) {
      errors.push('slug may only contain lowercase letters, numbers, and hyphens')
    } else if (slug.trim().length < 2 || slug.trim().length > 60) {
      errors.push('slug must be between 2 and 60 characters')
    }
  }

  if (plan !== undefined && !TENANT_PLANS.includes(plan)) {
    errors.push(`plan must be one of: ${TENANT_PLANS.join(', ')}`)
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateTenant ──────────────────────────────────────

/**
 * Validates a tenant update — all fields optional.
 * slug is immutable after creation.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateTenant = (body) => {
  const errors = []
  const { name, slug, plan, isActive } = body

  // slug is immutable — reject if sent
  if (slug !== undefined) {
    errors.push('slug cannot be changed after creation')
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  if (plan !== undefined && !TENANT_PLANS.includes(plan)) {
    errors.push(`plan must be one of: ${TENANT_PLANS.join(', ')}`)
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean')
  }

  return { isValid: errors.length === 0, errors }
}