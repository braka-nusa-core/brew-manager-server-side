// ============================================================
// utils/checkPlanLimit.js
// Reusable plan limit and feature enforcement utility.
//
// Used by every create* service function to enforce plan limits
// before inserting a new document.
//
// Exports:
//   checkPlanLimit(tenantId, resource)
//     — throws ApiError(403) if tenant is at or over their
//       effective limit for `resource`.
//
//   checkPlanFeature(tenantId, feature)
//     — throws ApiError(403) if `feature` flag is false on the
//       tenant's current plan.
//
// Effective limit = Plan.limits.maxX + Subscription.addOns.extraX
//
// Graceful degradation:
//   If no Subscription exists for the tenant (e.g. legacy tenant
//   not yet seeded), a WARNING is logged and the operation is
//   ALLOWED. This prevents blocking existing tenants until the
//   seed script has been run.
//
// Resource key → limit field mapping:
//   'outlets'   → maxOutlets   + extraOutlets
//   'employees' → maxEmployees + extraEmployees
//   'admins'    → maxAdmins    + extraAdmins
//   'bikes'     → maxBikes     (no add-on)
//   'products'  → maxProducts  (no add-on)
//
// Admin counting rule:
//   'admins' counts User documents with role IN
//   ['manager', 'cashier', 'viewer'] — tenant_admin is NEVER
//   counted (always 1, always allowed).
//
// Sprint 2 — Subscription & Plan Management
// ============================================================

import mongoose      from 'mongoose'
import Subscription  from '../models/Subscription.model.js'
import Plan          from '../models/Plan.model.js'
import Outlet        from '../models/Outlet.model.js'
import Employee      from '../models/Employee.model.js'
import User          from '../models/User.model.js'
import Bike          from '../models/Bike.model.js'
import Product       from '../models/Product.model.js'
import ApiError      from './ApiError.js'
import logger        from './logger.js'

// ── Resource configuration map ────────────────────────────────
// Defines: which Model to count, which filter to apply,
// which Plan.limits field to read, which addOns field to add.
// addOnField: null means no add-on exists for this resource.

const RESOURCE_CONFIG = {
  outlets: {
    Model:        Outlet,
    filter:      (tid) => ({ tenantId: tid, deletedAt: null }),
    limitField:  'maxOutlets',
    addOnField:  'extraOutlets',
    label:       'outlets',
  },
  employees: {
    Model:        Employee,
    filter:      (tid) => ({ tenantId: tid, isActive: true }),
    limitField:  'maxEmployees',
    addOnField:  'extraEmployees',
    label:       'employees',
  },
  admins: {
    Model:        User,
    filter:      (tid) => ({
      tenantId: tid,
      role:     { $in: ['manager', 'cashier', 'viewer'] },
    }),
    limitField:  'maxAdmins',
    addOnField:  'extraAdmins',
    label:       'admin accounts',
  },
  bikes: {
    Model:        Bike,
    filter:      (tid) => ({ tenantId: tid, isActive: { $ne: false } }),
    limitField:  'maxBikes',
    addOnField:  null,
    label:       'bikes',
  },
  products: {
    Model:        Product,
    filter:      (tid) => ({ tenantId: tid, isActive: { $ne: false } }),
    limitField:  'maxProducts',
    addOnField:  null,
    label:       'products',
  },
}

// ── Internal: fetch active plan for tenant ────────────────────

/**
 * Fetches the active Subscription and its referenced Plan for a tenant.
 * Returns { subscription, plan } or null if no subscription exists.
 *
 * @param {string|mongoose.Types.ObjectId} tenantId
 * @returns {Promise<{ subscription, plan } | null>}
 */
const getActivePlan = async (tenantId) => {
  const tenantOid = typeof tenantId === 'string'
    ? new mongoose.Types.ObjectId(tenantId)
    : tenantId

  const subscription = await Subscription.findOne({ tenantId: tenantOid }).lean()
  if (!subscription) return null

  const plan = await Plan.findById(subscription.planId).lean()
  if (!plan) return null

  return { subscription, plan }
}

// ── checkPlanLimit ────────────────────────────────────────────

/**
 * Verifies the tenant has not reached their effective limit for `resource`.
 * Effective limit = Plan.limits.maxX + Subscription.addOns.extraX
 *
 * If -1 (unlimited), always allows.
 *
 * Call this BEFORE creating a new document:
 *   await checkPlanLimit(tenantId, 'outlets')
 *   // ... create outlet
 *
 * @param {string} tenantId
 * @param {string} resource — key in RESOURCE_CONFIG
 * @throws {ApiError} 403 if limit reached
 * @throws {ApiError} 400 if resource key is unknown
 */
export const checkPlanLimit = async (tenantId, resource) => {
  const config = RESOURCE_CONFIG[resource]
  if (!config) {
    throw new ApiError(400, `Unknown plan resource: "${resource}"`)
  }

  const tenantOid = new mongoose.Types.ObjectId(tenantId)

  // ── Fetch plan & subscription ──────────────────────────────
  const result = await getActivePlan(tenantOid)

  if (!result) {
    // Graceful degradation: no subscription found — allow but warn.
    // This handles legacy tenants created before Sprint 2.
    logger.warn(`checkPlanLimit: no subscription found for tenant ${tenantId} (resource: ${resource}). Allowing — run seedPlans.js to create subscriptions.`)
    return
  }

  const { subscription, plan } = result

  // ── Read effective limit ───────────────────────────────────
  const planLimit   = plan.limits?.[config.limitField] ?? -1
  const addOnExtra  = config.addOnField
    ? (subscription.addOns?.[config.addOnField] ?? 0)
    : 0
  const effectiveLimit = planLimit === -1 ? -1 : planLimit + addOnExtra

  // -1 = unlimited
  if (effectiveLimit === -1) return

  // ── Count current documents ────────────────────────────────
  const currentCount = await config.Model.countDocuments(config.filter(tenantOid))

  if (currentCount >= effectiveLimit) {
    throw new ApiError(
      403,
      `Plan limit reached: your ${plan.name} plan allows up to ${effectiveLimit} ${config.label}` +
      (addOnExtra > 0 ? ` (${planLimit} base + ${addOnExtra} add-on)` : '') +
      `. You currently have ${currentCount}. Upgrade your plan or add-on to create more.`
    )
  }
}

// ── checkPlanFeature ──────────────────────────────────────────

/**
 * Verifies the tenant's plan has the given feature flag enabled.
 *
 * @param {string} tenantId
 * @param {string} feature — key in Plan.features (e.g. 'advancedDashboard')
 * @throws {ApiError} 403 if feature is not available on the plan
 */
export const checkPlanFeature = async (tenantId, feature) => {
  const tenantOid = new mongoose.Types.ObjectId(tenantId)
  const result    = await getActivePlan(tenantOid)

  if (!result) {
    // Graceful degradation — allow if no subscription (legacy tenant)
    logger.warn(`checkPlanFeature: no subscription found for tenant ${tenantId} (feature: ${feature}). Allowing.`)
    return
  }

  const { plan } = result
  const available = plan.features?.[feature]

  if (available === false) {
    throw new ApiError(
      403,
      `This feature (${feature}) is not available on your current ${plan.name} plan. Upgrade to unlock it.`
    )
  }
}

/**
 * Returns the tenant's current subscription + plan without throwing.
 * Used by subscription endpoints to return effective limits to the client.
 *
 * @param {string} tenantId
 * @returns {Promise<{ subscription, plan } | null>}
 */
export const getActivePlanForTenant = async (tenantId) => {
  return getActivePlan(tenantId)
}