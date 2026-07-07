// ============================================================
// modules/subscription/subscription.service.js
// Subscription management + Upgrade Request workflow.
//
// Responsibilities:
//   ✅ Create/update subscriptions (super_admin)
//   ✅ Read own subscription (tenant_admin)
//   ✅ Create upgrade request (tenant_admin)
//   ✅ Approve/reject upgrade request (super_admin)
//   ✅ Notify via existing Notification Center (non-throwing)
//   ✅ Sync Tenant.plan label on plan changes
//
// Effective limits are COMPUTED on read:
//   effectiveMaxX = Plan.limits.maxX + Subscription.addOns.extraX
//   This is returned to callers, never stored.
//
// Sprint 2 — Subscription & Plan Management
// ============================================================

import mongoose      from 'mongoose'
import Subscription  from '../../models/Subscription.model.js'
import UpgradeRequest from '../../models/UpgradeRequest.model.js'
import Plan          from '../../models/Plan.model.js'
import Tenant        from '../../models/Tenant.model.js'
import ApiError      from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import {
  notifyUpgradeRequestSubmitted,
  notifyUpgradeRequestResolved,
} from '../notification/notification.service.js'

// ── Internal: compute effective limits ────────────────────────

/**
 * Computes the effective resource limits for a subscription.
 * effectiveMaxX = plan.limits.maxX + subscription.addOns.extraX
 * -1 stays -1 (unlimited).
 *
 * @param {Object} plan         - Plan document (lean)
 * @param {Object} subscription - Subscription document (lean)
 * @returns {Object} effectiveLimits
 */
const computeEffectiveLimits = (plan, subscription) => {
  const limits   = plan.limits   ?? {}
  const addOns   = subscription.addOns ?? {}

  const calc = (base, extra) => (base === -1 ? -1 : (base ?? 0) + (extra ?? 0))

  return {
    maxOutlets:   calc(limits.maxOutlets,   addOns.extraOutlets),
    maxEmployees: calc(limits.maxEmployees, addOns.extraEmployees),
    maxAdmins:    calc(limits.maxAdmins,    addOns.extraAdmins),
    maxBikes:     limits.maxBikes   ?? -1,
    maxProducts:  limits.maxProducts ?? -1,
  }
}

/**
 * Builds a full subscription response: subscription + plan + effectiveLimits.
 */
const buildSubscriptionResponse = (subscription, plan) => ({
  ...subscription,
  plan,
  effectiveLimits: computeEffectiveLimits(plan, subscription),
})

// ── createSubscription ────────────────────────────────────────

/**
 * Creates a subscription for a tenant. Called by:
 *   - super_admin directly
 *   - bootstrapTenant (internally, no auth)
 *
 * @param {Object} data - { tenantId, planId, status, billingCycle, startedAt, expiredAt, maintenanceUntil, addOns, notes }
 * @returns {Promise<Object>} created subscription
 */
export const createSubscription = async (data) => {
  const plan = await Plan.findById(new mongoose.Types.ObjectId(data.planId)).lean()
  if (!plan) throw new ApiError(404, 'Plan not found')

  // Verify tenant exists
  const tenant = await Tenant.findById(new mongoose.Types.ObjectId(data.tenantId)).lean()
  if (!tenant) throw new ApiError(404, 'Tenant not found')

  try {
    const subscription = await Subscription.create({
      tenantId:         new mongoose.Types.ObjectId(data.tenantId),
      planId:           plan._id,
      planSlug:         plan.slug,
      status:           data.status         ?? 'trial',
      billingCycle:     data.billingCycle   ?? 'monthly',
      startedAt:        new Date(data.startedAt),
      expiredAt:        data.expiredAt         ? new Date(data.expiredAt)         : null,
      maintenanceUntil: data.maintenanceUntil  ? new Date(data.maintenanceUntil)  : null,
      autoRenew:        data.autoRenew         ?? true,
      addOns:           data.addOns            ?? {},
      notes:            data.notes             ?? null,
    })

    return buildSubscriptionResponse(subscription.toObject(), plan)
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'This tenant already has a subscription. Use PATCH to update it.')
    }
    throw err
  }
}

// ── getSubscriptions ──────────────────────────────────────────

/**
 * Paginated list — super_admin only.
 */
export const getSubscriptions = async (queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)
  const filter = {}

  if (queryParams.status)   filter.status   = queryParams.status
  if (queryParams.planSlug) filter.planSlug = queryParams.planSlug

  const [subscriptions, total] = await Promise.all([
    Subscription.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Subscription.countDocuments(filter),
  ])

  return {
    subscriptions,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getSubscriptionByTenantId ─────────────────────────────────

/**
 * Returns subscription + plan + effectiveLimits for one tenant.
 * Used by both super_admin (any tenantId) and tenant_admin (/my).
 */
export const getSubscriptionByTenantId = async (tenantId) => {
  const tenantOid    = new mongoose.Types.ObjectId(tenantId)
  const subscription = await Subscription.findOne({ tenantId: tenantOid }).lean()

  if (!subscription) throw new ApiError(404, 'No subscription found for this tenant')

  const plan = await Plan.findById(subscription.planId).lean()
  if (!plan) throw new ApiError(500, 'Subscription references a deleted plan — contact support')

  return buildSubscriptionResponse(subscription, plan)
}

// ── updateSubscription ────────────────────────────────────────

/**
 * Updates a tenant's subscription — super_admin only.
 * If planId changes, syncs Tenant.plan and planSlug.
 *
 * @param {string} tenantId
 * @param {Object} data - validated update fields
 */
export const updateSubscription = async (tenantId, data) => {
  const tenantOid    = new mongoose.Types.ObjectId(tenantId)
  const subscription = await Subscription.findOne({ tenantId: tenantOid })

  if (!subscription) throw new ApiError(404, 'No subscription found for this tenant')

  let plan = null

  // If plan is changing, validate new plan and sync labels
  if (data.planId) {
    plan = await Plan.findById(new mongoose.Types.ObjectId(data.planId)).lean()
    if (!plan) throw new ApiError(404, 'Plan not found')

    subscription.planId   = plan._id
    subscription.planSlug = plan.slug

    // Sync Tenant.plan label (non-authoritative — display only)
    await Tenant.findByIdAndUpdate(tenantOid, { plan: plan.slug }).catch(() => {})
  }

  // Apply other fields
  const dateFields = ['startedAt', 'expiredAt', 'maintenanceUntil']
  for (const field of dateFields) {
    if (data[field] !== undefined) {
      subscription[field] = data[field] ? new Date(data[field]) : null
    }
  }

  const scalarFields = ['status', 'billingCycle', 'autoRenew', 'notes']
  for (const field of scalarFields) {
    if (data[field] !== undefined) subscription[field] = data[field]
  }

  if (data.addOns) {
    const addOnFields = ['extraOutlets', 'extraEmployees', 'extraAdmins']
    for (const field of addOnFields) {
      if (data.addOns[field] !== undefined) {
        subscription.addOns[field] = data.addOns[field]
      }
    }
    subscription.markModified('addOns')
  }

  await subscription.save()

  // Fetch live plan if not already loaded
  if (!plan) {
    plan = await Plan.findById(subscription.planId).lean()
  }

  return buildSubscriptionResponse(subscription.toObject(), plan)
}

// ══════════════════════════════════════════════════════════════
// UPGRADE REQUEST WORKFLOW
// ══════════════════════════════════════════════════════════════

// ── createUpgradeRequest ──────────────────────────────────────

/**
 * Tenant admin submits an upgrade request.
 * Blocks if there is already a pending request for this tenant.
 *
 * @param {string} tenantId  - req.tenantId
 * @param {Object} caller    - req.user
 * @param {Object} data      - { toPlanId, reason? }
 */
export const createUpgradeRequest = async (tenantId, caller, data) => {
  const tenantOid = new mongoose.Types.ObjectId(tenantId)

  // Block duplicate pending requests
  const existingPending = await UpgradeRequest.findOne({
    tenantId: tenantOid,
    status:   'pending',
  }).lean()

  if (existingPending) {
    throw new ApiError(409, 'You already have a pending upgrade request. Wait for it to be resolved before submitting another.')
  }

  // Validate target plan
  const toPlan = await Plan.findById(new mongoose.Types.ObjectId(data.toPlanId)).lean()
  if (!toPlan || !toPlan.isActive) throw new ApiError(404, 'Target plan not found or inactive')

  // Get current subscription
  const subscription = await Subscription.findOne({ tenantId: tenantOid }).lean()
  if (!subscription) throw new ApiError(404, 'No active subscription found for your tenant')

  const fromPlan = await Plan.findById(subscription.planId).lean()

  // Prevent requesting the same plan
  if (subscription.planId.toString() === toPlan._id.toString()) {
    throw new ApiError(400, 'You are already on this plan')
  }

  const tenant = await Tenant.findById(tenantOid).lean()

  const request = await UpgradeRequest.create({
    tenantId:     tenantOid,
    requestedBy:  new mongoose.Types.ObjectId(caller.userId),
    fromPlanId:   fromPlan?._id ?? null,
    toPlanId:     toPlan._id,
    fromPlanSlug: fromPlan?.slug ?? null,
    toPlanSlug:   toPlan.slug,
    reason:       data.reason?.trim() ?? null,
    status:       'pending',
  })

  // Notify super admins — non-throwing
  await notifyUpgradeRequestSubmitted({
    tenantId,
    tenantName:   tenant?.name ?? 'A tenant',
    requestId:    request._id,
    fromPlanSlug: fromPlan?.slug ?? '(unknown)',
    toPlanSlug:   toPlan.slug,
  })

  return request.toObject()
}

// ── getUpgradeRequests ────────────────────────────────────────

/**
 * Paginated list of upgrade requests — super_admin sees all,
 * tenant_admin sees only their own (filtered by tenantId).
 */
export const getUpgradeRequests = async (caller, tenantId, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)
  const filter = {}

  if (caller.role !== 'super_admin') {
    filter.tenantId = new mongoose.Types.ObjectId(tenantId)
  } else if (queryParams.tenantId) {
    filter.tenantId = new mongoose.Types.ObjectId(queryParams.tenantId)
  }

  if (queryParams.status) filter.status = queryParams.status

  const [requests, total] = await Promise.all([
    UpgradeRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    UpgradeRequest.countDocuments(filter),
  ])

  return {
    upgradeRequests: requests,
    pagination:      buildPaginationMeta({ total, page, limit }),
  }
}

// ── resolveUpgradeRequest ─────────────────────────────────────

/**
 * Super admin approves or rejects an upgrade request.
 * On approval: Subscription.planId updated, Tenant.plan synced.
 *
 * @param {string} requestId
 * @param {string} resolution - 'approved' | 'rejected'
 * @param {Object} caller     - req.user (super_admin)
 * @param {Object} data       - { adminNotes?, maintenanceUntil? }
 */
export const resolveUpgradeRequest = async (requestId, resolution, caller, data = {}) => {
  const request = await UpgradeRequest.findById(new mongoose.Types.ObjectId(requestId))
  if (!request) throw new ApiError(404, 'Upgrade request not found')
  if (request.status !== 'pending') {
    throw new ApiError(400, `This request has already been ${request.status}`)
  }

  request.status     = resolution
  request.resolvedBy = new mongoose.Types.ObjectId(caller.userId)
  request.resolvedAt = new Date()
  request.adminNotes = data.adminNotes?.trim() ?? null
  await request.save()

  // On approval: update subscription plan + sync Tenant.plan label
  if (resolution === 'approved') {
    const newPlan = await Plan.findById(request.toPlanId).lean()
    if (!newPlan) throw new ApiError(500, 'Target plan no longer exists')

    const tenantOid = request.tenantId

    const subscription = await Subscription.findOne({ tenantId: tenantOid })
    if (subscription) {
      subscription.planId   = newPlan._id
      subscription.planSlug = newPlan.slug
      subscription.status   = 'active'
      if (data.maintenanceUntil) {
        subscription.maintenanceUntil = new Date(data.maintenanceUntil)
      }
      await subscription.save()
    }

    // Sync Tenant.plan label — best-effort, non-throwing
    await Tenant.findByIdAndUpdate(tenantOid, { plan: newPlan.slug }).catch(() => {})
  }

  // Notify tenant_admin — non-throwing
  await notifyUpgradeRequestResolved({
    tenantId:    request.tenantId.toString(),
    requestId:   request._id,
    status:      resolution,
    toPlanSlug:  request.toPlanSlug,
    adminNotes:  request.adminNotes,
  })

  return request.toObject()
}