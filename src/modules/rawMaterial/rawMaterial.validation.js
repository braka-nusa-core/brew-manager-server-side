// ============================================================
// modules/rawMaterial/rawMaterial.validation.js
// Pure validation for raw material operations.
// No Express dependency — independently testable.
// Mirrors product.validation.js exactly.
// ============================================================

import { RAW_MATERIAL_UNITS } from '../../models/RawMaterial.model.js'

// ── validateCreateRawMaterial ─────────────────────────────────

/**
 * Validates request body for creating a raw material.
 * tenantId comes from req.tenantId (JWT) — never validated here.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateRawMaterial = (body) => {
  const errors = []
  const { name, unit, costPerUnit } = body

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  if (!unit) {
    errors.push('unit is required')
  } else if (!RAW_MATERIAL_UNITS.includes(unit)) {
    errors.push(`unit must be one of: ${RAW_MATERIAL_UNITS.join(', ')}`)
  }

  if (costPerUnit === undefined || costPerUnit === null) {
    errors.push('costPerUnit is required')
  } else if (typeof costPerUnit !== 'number' || isNaN(costPerUnit)) {
    errors.push('costPerUnit must be a number')
  } else if (costPerUnit < 0) {
    errors.push('costPerUnit cannot be negative')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateRawMaterial ─────────────────────────────────

/**
 * Validates request body for updating a raw material.
 * Only name, unit, costPerUnit, isActive are mutable.
 * tenantId is immutable.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateRawMaterial = (body) => {
  const errors = []
  const { tenantId, name, unit, costPerUnit, isActive } = body

  // Guard immutable field
  if (tenantId !== undefined) {
    errors.push('tenantId cannot be changed')
  }

  // At least one mutable field required
  if (
    name        === undefined &&
    unit        === undefined &&
    costPerUnit === undefined &&
    isActive    === undefined
  ) {
    errors.push('At least one of name, unit, costPerUnit, or isActive must be provided')
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  if (unit !== undefined && !RAW_MATERIAL_UNITS.includes(unit)) {
    errors.push(`unit must be one of: ${RAW_MATERIAL_UNITS.join(', ')}`)
  }

  if (costPerUnit !== undefined) {
    if (typeof costPerUnit !== 'number' || isNaN(costPerUnit)) {
      errors.push('costPerUnit must be a number')
    } else if (costPerUnit < 0) {
      errors.push('costPerUnit cannot be negative')
    }
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean')
  }

  return { isValid: errors.length === 0, errors }
}