// ============================================================
// modules/subscription/subscription.routes.js
//
// Subscription routes — mounted at /api/v1/subscriptions
// Upgrade Request routes — mounted at /api/v1/upgrade-requests
//
// Authorization matrix:
//   MANAGE_SUBSCRIPTIONS   → super_admin only
//   VIEW_SUBSCRIPTIONS     → super_admin + tenant_admin
//   MANAGE_UPGRADE_REQUESTS → super_admin + tenant_admin
//
// ROUTE ORDER NOTE:
//   /my must be before /:tenantId (specific before param)
//   /approve and /reject must be before /:requestId
//
// Sprint 2 — Subscription & Plan Management
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  create,
  getAll,
  getMy,
  getByTenantId,
  update,
  submitUpgradeRequest,
  listUpgradeRequests,
  approveUpgradeRequest,
  rejectUpgradeRequest,
} from './subscription.controller.js'

// ── Subscription Router ───────────────────────────────────────

export const subscriptionRouter = Router()

subscriptionRouter.use(authenticate)
subscriptionRouter.use(tenantGuard)

// GET /subscriptions/my — tenant_admin views own subscription (specific before param)
subscriptionRouter.get(
  '/my',
  authorize(PERMISSIONS.VIEW_SUBSCRIPTIONS),
  getMy
)

// GET /subscriptions — super_admin lists all subscriptions
subscriptionRouter.get(
  '/',
  authorize(PERMISSIONS.MANAGE_SUBSCRIPTIONS),
  getAll
)

// POST /subscriptions — super_admin creates subscription
subscriptionRouter.post(
  '/',
  authorize(PERMISSIONS.MANAGE_SUBSCRIPTIONS),
  create
)

// GET /subscriptions/:tenantId — super_admin views any tenant's subscription
subscriptionRouter.get(
  '/:tenantId',
  validateObjectId('tenantId'),
  authorize(PERMISSIONS.MANAGE_SUBSCRIPTIONS),
  getByTenantId
)

// PATCH /subscriptions/:tenantId — super_admin updates any tenant's subscription
subscriptionRouter.patch(
  '/:tenantId',
  validateObjectId('tenantId'),
  authorize(PERMISSIONS.MANAGE_SUBSCRIPTIONS),
  update
)

// ── Upgrade Request Router ────────────────────────────────────

export const upgradeRequestRouter = Router()

upgradeRequestRouter.use(authenticate)
upgradeRequestRouter.use(tenantGuard)

// POST /upgrade-requests — tenant_admin submits request
upgradeRequestRouter.post(
  '/',
  authorize(PERMISSIONS.MANAGE_UPGRADE_REQUESTS),
  submitUpgradeRequest
)

// GET /upgrade-requests — super_admin sees all, tenant_admin sees own
upgradeRequestRouter.get(
  '/',
  authorize(PERMISSIONS.MANAGE_UPGRADE_REQUESTS),
  listUpgradeRequests
)

// PATCH /upgrade-requests/:requestId/approve — super_admin only
upgradeRequestRouter.patch(
  '/:requestId/approve',
  validateObjectId('requestId'),
  authorize(PERMISSIONS.MANAGE_SUBSCRIPTIONS),
  approveUpgradeRequest
)

// PATCH /upgrade-requests/:requestId/reject — super_admin only
upgradeRequestRouter.patch(
  '/:requestId/reject',
  validateObjectId('requestId'),
  authorize(PERMISSIONS.MANAGE_SUBSCRIPTIONS),
  rejectUpgradeRequest
)