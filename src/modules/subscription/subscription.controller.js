// ============================================================
// modules/subscription/subscription.controller.js
// Handles both Subscription and UpgradeRequest endpoints.
// Zero business logic — all logic in subscription.service.js.
// Sprint 2 — Subscription & Plan Management
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateCreateSubscription,
  validateUpdateSubscription,
  validateCreateUpgradeRequest,
  validateResolveUpgradeRequest,
} from './subscription.validation.js'
import {
  createSubscription,
  getSubscriptions,
  getSubscriptionByTenantId,
  updateSubscription,
  createUpgradeRequest,
  getUpgradeRequests,
  resolveUpgradeRequest,
} from './subscription.service.js'

// ── Subscription endpoints ────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateSubscription(req.body)
  if (!isValid) return res.status(400).json(errorResponse('Validation failed', 400, errors))

  const subscription = await createSubscription(req.body)
  return res.status(201).json(successResponse('Subscription created successfully', subscription))
})

export const getAll = asyncHandler(async (req, res) => {
  const { subscriptions, pagination } = await getSubscriptions(req.query)
  return res.status(200).json({
    success: true,
    message: 'Subscriptions retrieved successfully',
    data:    subscriptions,
    pagination,
  })
})

// GET /subscriptions/my — tenant_admin views their own subscription
export const getMy = asyncHandler(async (req, res) => {
  const subscription = await getSubscriptionByTenantId(req.tenantId)
  return res.status(200).json(successResponse('Subscription retrieved successfully', subscription))
})

// GET /subscriptions/:tenantId — super_admin views any tenant's subscription
export const getByTenantId = asyncHandler(async (req, res) => {
  const subscription = await getSubscriptionByTenantId(req.params.tenantId)
  return res.status(200).json(successResponse('Subscription retrieved successfully', subscription))
})

// PATCH /subscriptions/:tenantId — super_admin updates any tenant's subscription
export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateSubscription(req.body)
  if (!isValid) return res.status(400).json(errorResponse('Validation failed', 400, errors))

  const subscription = await updateSubscription(req.params.tenantId, req.body)
  return res.status(200).json(successResponse('Subscription updated successfully', subscription))
})

// ── Upgrade Request endpoints ─────────────────────────────────

export const submitUpgradeRequest = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateUpgradeRequest(req.body)
  if (!isValid) return res.status(400).json(errorResponse('Validation failed', 400, errors))

  const request = await createUpgradeRequest(req.tenantId, req.user, req.body)
  return res.status(201).json(successResponse('Upgrade request submitted successfully', request))
})

export const listUpgradeRequests = asyncHandler(async (req, res) => {
  const { upgradeRequests, pagination } = await getUpgradeRequests(req.user, req.tenantId, req.query)
  return res.status(200).json({
    success: true,
    message: 'Upgrade requests retrieved successfully',
    data:    upgradeRequests,
    pagination,
  })
})

export const approveUpgradeRequest = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateResolveUpgradeRequest(req.body)
  if (!isValid) return res.status(400).json(errorResponse('Validation failed', 400, errors))

  const request = await resolveUpgradeRequest(req.params.requestId, 'approved', req.user, req.body)
  return res.status(200).json(successResponse('Upgrade request approved', request))
})

export const rejectUpgradeRequest = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateResolveUpgradeRequest(req.body)
  if (!isValid) return res.status(400).json(errorResponse('Validation failed', 400, errors))

  const request = await resolveUpgradeRequest(req.params.requestId, 'rejected', req.user, req.body)
  return res.status(200).json(successResponse('Upgrade request rejected', request))
})