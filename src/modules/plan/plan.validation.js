// ============================================================
// modules/plan/plan.validation.js
// Sprint 2 — Plan Management
// ============================================================

import { PLAN_SLUGS } from '../../models/Plan.model.js'

// ── validateCreatePlan ────────────────────────────────────────

export const validateCreatePlan = (body) => {
  const errors = []
  const { name, slug, limits, features, price, sortOrder } = body

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  }

  if (!slug || !PLAN_SLUGS.includes(slug)) {
    errors.push(`slug is required and must be one of: ${PLAN_SLUGS.join(', ')}`)
  }

  if (limits !== undefined) {
    const limitFields = ['maxOutlets', 'maxEmployees', 'maxAdmins', 'maxBikes', 'maxProducts']
    for (const field of limitFields) {
      if (limits[field] !== undefined && (typeof limits[field] !== 'number' || limits[field] < -1)) {
        errors.push(`limits.${field} must be a number >= -1 (-1 means unlimited)`)
      }
    }
  }

  if (features !== undefined && typeof features !== 'object') {
    errors.push('features must be an object')
  }

  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    errors.push('price must be a non-negative number')
  }

  if (sortOrder !== undefined && (typeof sortOrder !== 'number' || sortOrder < 0)) {
    errors.push('sortOrder must be a non-negative number')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdatePlan ────────────────────────────────────────

export const validateUpdatePlan = (body) => {
  const errors = []
  const { name, description, limits, features, price, sortOrder, addOnPrices } = body

  const mutableFields = [name, description, limits, features, price, sortOrder, addOnPrices]
  if (mutableFields.every((v) => v === undefined)) {
    errors.push('At least one field must be provided to update')
  }

  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2)) {
    errors.push('name must be at least 2 characters')
  }

  if (limits !== undefined) {
    const limitFields = ['maxOutlets', 'maxEmployees', 'maxAdmins', 'maxBikes', 'maxProducts']
    for (const field of limitFields) {
      if (limits[field] !== undefined && (typeof limits[field] !== 'number' || limits[field] < -1)) {
        errors.push(`limits.${field} must be a number >= -1 (-1 means unlimited)`)
      }
    }
  }

  if (features !== undefined && typeof features !== 'object') {
    errors.push('features must be an object')
  }

  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    errors.push('price must be a non-negative number')
  }

  if (sortOrder !== undefined && (typeof sortOrder !== 'number' || sortOrder < 0)) {
    errors.push('sortOrder must be a non-negative number')
  }

  return { isValid: errors.length === 0, errors }
}