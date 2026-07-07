// ============================================================
// modules/subscription/subscription.validation.js
// Sprint 2 — Subscription & Plan Management
// ============================================================

import mongoose from 'mongoose'
import { SUBSCRIPTION_STATUSES, BILLING_CYCLES } from '../../models/Subscription.model.js'

const isValidObjectId = (v) => mongoose.Types.ObjectId.isValid(v)
const isDate          = (v) => !isNaN(Date.parse(v))

// ── validateCreateSubscription ────────────────────────────────

export const validateCreateSubscription = (body) => {
  const errors = []
  const { tenantId, planId, status, billingCycle, startedAt, expiredAt, maintenanceUntil, addOns } = body

  if (!tenantId || !isValidObjectId(tenantId))  errors.push('tenantId must be a valid ObjectId')
  if (!planId   || !isValidObjectId(planId))    errors.push('planId must be a valid ObjectId')

  if (status && !SUBSCRIPTION_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}`)
  }

  if (billingCycle && !BILLING_CYCLES.includes(billingCycle)) {
    errors.push(`billingCycle must be one of: ${BILLING_CYCLES.join(', ')}`)
  }

  if (!startedAt || !isDate(startedAt)) errors.push('startedAt must be a valid date')
  if (expiredAt !== undefined && expiredAt !== null && !isDate(expiredAt)) {
    errors.push('expiredAt must be a valid date or null')
  }
  if (maintenanceUntil !== undefined && maintenanceUntil !== null && !isDate(maintenanceUntil)) {
    errors.push('maintenanceUntil must be a valid date or null')
  }

  if (addOns) {
    const addOnFields = ['extraOutlets', 'extraEmployees', 'extraAdmins']
    for (const field of addOnFields) {
      if (addOns[field] !== undefined && (typeof addOns[field] !== 'number' || addOns[field] < 0)) {
        errors.push(`addOns.${field} must be a non-negative number`)
      }
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateSubscription ────────────────────────────────

export const validateUpdateSubscription = (body) => {
  const errors = []
  const { planId, status, billingCycle, startedAt, expiredAt, maintenanceUntil, autoRenew, notes, addOns } = body

  const mutableFields = [planId, status, billingCycle, startedAt, expiredAt, maintenanceUntil, autoRenew, notes, addOns]
  if (mutableFields.every((v) => v === undefined)) {
    errors.push('At least one field must be provided to update')
  }

  if (planId !== undefined && !isValidObjectId(planId)) errors.push('planId must be a valid ObjectId')

  if (status && !SUBSCRIPTION_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}`)
  }
  if (billingCycle && !BILLING_CYCLES.includes(billingCycle)) {
    errors.push(`billingCycle must be one of: ${BILLING_CYCLES.join(', ')}`)
  }

  if (expiredAt !== undefined && expiredAt !== null && !isDate(expiredAt)) {
    errors.push('expiredAt must be a valid date or null')
  }
  if (maintenanceUntil !== undefined && maintenanceUntil !== null && !isDate(maintenanceUntil)) {
    errors.push('maintenanceUntil must be a valid date or null')
  }
  if (autoRenew !== undefined && typeof autoRenew !== 'boolean') {
    errors.push('autoRenew must be a boolean')
  }

  if (addOns) {
    const addOnFields = ['extraOutlets', 'extraEmployees', 'extraAdmins']
    for (const field of addOnFields) {
      if (addOns[field] !== undefined && (typeof addOns[field] !== 'number' || addOns[field] < 0)) {
        errors.push(`addOns.${field} must be a non-negative number`)
      }
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateCreateUpgradeRequest ─────────────────────────────

export const validateCreateUpgradeRequest = (body) => {
  const errors = []
  const { toPlanId, reason } = body

  if (!toPlanId || !isValidObjectId(toPlanId)) {
    errors.push('toPlanId must be a valid ObjectId')
  }

  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string') errors.push('reason must be a string')
    else if (reason.trim().length > 500) errors.push('reason must not exceed 500 characters')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateResolveUpgradeRequest ─────────────────────────────

export const validateResolveUpgradeRequest = (body) => {
  const errors = []
  const { adminNotes, maintenanceUntil } = body

  if (adminNotes !== undefined && adminNotes !== null) {
    if (typeof adminNotes !== 'string') errors.push('adminNotes must be a string')
    else if (adminNotes.trim().length > 500) errors.push('adminNotes must not exceed 500 characters')
  }

  if (maintenanceUntil !== undefined && maintenanceUntil !== null && !isDate(maintenanceUntil)) {
    errors.push('maintenanceUntil must be a valid date or null')
  }

  return { isValid: errors.length === 0, errors }
}