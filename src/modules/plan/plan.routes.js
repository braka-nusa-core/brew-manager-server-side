// ============================================================
// modules/plan/plan.routes.js
// Mounted at: /api/v1/plans
//
// GET  /          → PUBLIC (no auth) — tenants need to see plans
// GET  /:planId   → PUBLIC
// POST /          → super_admin (MANAGE_PLANS)
// PATCH /:planId/toggle-active → super_admin
// PATCH /:planId  → super_admin
//
// ROUTE ORDER: toggle-active before /:planId (Express specificity)
// Sprint 2 — Subscription & Plan Management
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import { getAll, getOne, create, update, toggleActive } from './plan.controller.js'

const router = Router()

// ── Public reads (no auth) ────────────────────────────────────
router.get('/', getAll)
router.get('/:planId', validateObjectId('planId'), getOne)

// ── Protected writes (super_admin only) ───────────────────────
router.post(
  '/',
  authenticate, tenantGuard, authorize(PERMISSIONS.MANAGE_PLANS),
  create
)

router.patch(
  '/:planId/toggle-active',
  validateObjectId('planId'),
  authenticate, tenantGuard, authorize(PERMISSIONS.MANAGE_PLANS),
  toggleActive
)

router.patch(
  '/:planId',
  validateObjectId('planId'),
  authenticate, tenantGuard, authorize(PERMISSIONS.MANAGE_PLANS),
  update
)

export default router