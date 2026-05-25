// ============================================================
// modules/outlet/outlet.routes.js
// Mounted at: /api/v1/outlets
//
// Authorization matrix:
//   MANAGE_OUTLETS  → create, update, toggle-active, delete
//   VIEW_OUTLETS    → list, detail
//
// All roles:
//   super_admin  → all outlets (no tenant scope in tenantGuard)
//   tenant_admin → all outlets within their tenant
//   manager      → view their own outlet only (service enforces)
//   cashier      → view their own outlet only (service enforces)
//
// ROUTE ORDER:
//   /:outletId/toggle-active must be registered BEFORE /:outletId
//   to prevent Express matching "toggle-active" as an outletId value.
// ============================================================

import { Router }   from 'express'
import authenticate from '../../middlewares/authenticate.js'
import tenantGuard  from '../../middlewares/tenantGuard.js'
import authorize    from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  create,
  getAll,
  getOne,
  update,
  toggleActive,
  remove,
} from './outlet.controller.js'

const router = Router()

// All outlet routes require authentication + tenant context
router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/outlets ──────────────────────────────────────
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_OUTLETS),
  create
)

// ── GET /api/v1/outlets ───────────────────────────────────────
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_OUTLETS, PERMISSIONS.MANAGE_OUTLETS),
  getAll
)

// ── PATCH /api/v1/outlets/:outletId/toggle-active ─────────────
// MUST be before /:outletId to avoid route collision
router.patch(
  '/:outletId/toggle-active',
  validateObjectId('outletId'),
  authorize(PERMISSIONS.MANAGE_OUTLETS),
  toggleActive
)

// ── GET /api/v1/outlets/:outletId ─────────────────────────────
router.get(
  '/:outletId',
  validateObjectId('outletId'),
  authorize(PERMISSIONS.VIEW_OUTLETS, PERMISSIONS.MANAGE_OUTLETS),
  getOne
)

// ── PATCH /api/v1/outlets/:outletId ──────────────────────────
router.patch(
  '/:outletId',
  validateObjectId('outletId'),
  authorize(PERMISSIONS.MANAGE_OUTLETS),
  update
)

// ── DELETE /api/v1/outlets/:outletId ─────────────────────────
// Soft delete — sets deletedAt, preserves all operational data.
router.delete(
  '/:outletId',
  validateObjectId('outletId'),
  authorize(PERMISSIONS.MANAGE_OUTLETS),
  remove
)

export default router