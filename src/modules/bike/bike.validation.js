// ============================================================
// modules/bike/bike.validation.js
// Pure validation for bike operations. No Express, no DB calls.
//
// status and isActive are FORBIDDEN in generic create/update —
// status defaults to ACTIVE on create and is only changeable via
// the dedicated PATCH /:bikeId/status endpoint (validateBikeStatus
// below). isActive is only changeable via DELETE /:bikeId.
// Mirrors Employee's "isActive forbidden in generic update,
// use /toggle-active" convention exactly.
// ============================================================

import { BIKE_STATUSES } from '../../models/Bike.model.js'

const OBJECT_ID_RE = /^[a-f\d]{24}$/i
const isValidObjectId = (id) => typeof id === 'string' && OBJECT_ID_RE.test(id)

// ── validateCreateBike ────────────────────────────────────────

export const validateCreateBike = (body) => {
  const errors = []
  const { outletId, assetCode, name, status } = body

  if (!outletId) {
    errors.push('outletId is required')
  } else if (!isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  if (!assetCode || typeof assetCode !== 'string' || assetCode.trim().length < 2) {
    errors.push('assetCode is required and must be at least 2 characters')
  } else if (assetCode.trim().length > 20) {
    errors.push('assetCode must not exceed 20 characters')
  }

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  // status is NEVER allowed on create — always ACTIVE by default.
  if (status !== undefined) {
    errors.push('status cannot be set on create — bikes are always created as ACTIVE')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateBike ────────────────────────────────────────
// Allowed: name, assetCode, notes, outletId.
// Forbidden: status (use /status endpoint), isActive (use DELETE).

export const validateUpdateBike = (body) => {
  const errors = []
  const { tenantId, name, assetCode, notes, outletId, status, isActive } = body

  if (tenantId !== undefined) {
    errors.push('tenantId cannot be changed')
  }

  if (status !== undefined) {
    errors.push('Use the /status endpoint to change bike status')
  }

  if (isActive !== undefined) {
    errors.push('Use DELETE to deactivate a bike')
  }

  if (
    name      === undefined &&
    assetCode === undefined &&
    notes     === undefined &&
    outletId  === undefined
  ) {
    errors.push('At least one of name, assetCode, notes, or outletId must be provided')
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  if (assetCode !== undefined) {
    if (typeof assetCode !== 'string' || assetCode.trim().length < 2) {
      errors.push('assetCode must be at least 2 characters')
    } else if (assetCode.trim().length > 20) {
      errors.push('assetCode must not exceed 20 characters')
    }
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  if (outletId !== undefined && !isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateBikeStatus ────────────────────────────────────────
// Dedicated validator for PATCH /:bikeId/status.
// Business rule (bike cannot become ACTIVE with OPEN/IN_REPAIR
// damage reports) is enforced in bike.service.js — requires a DB
// lookup, not pure validation.

export const validateBikeStatus = (body) => {
  const errors = []
  const { status } = body

  if (!status) {
    errors.push('status is required')
  } else if (!BIKE_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${BIKE_STATUSES.join(', ')}`)
  }

  return { isValid: errors.length === 0, errors }
}