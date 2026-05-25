// ============================================================
// modules/tenant/tenant.routes.js
// Mounted at: /api/v1/tenants
//
// Route structure:
//   POST  /bootstrap     → PUBLIC — creates tenant + admin + outlet
//   GET   /              → super_admin only
//   POST  /              → super_admin only (direct creation)
//   GET   /:tenantId     → super_admin only
//   PATCH /:tenantId     → super_admin only
//   DELETE/:tenantId     → super_admin only (soft delete)
//
// CRITICAL ROUTE ORDER:
//   /bootstrap must be declared BEFORE /:tenantId
//   to prevent Express treating "bootstrap" as a tenantId param.
// ============================================================

import { Router }   from 'express'
import authenticate from '../../middlewares/authenticate.js'
import tenantGuard  from '../../middlewares/tenantGuard.js'
import authorize    from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  bootstrap,
  getAll,
  getOne,
  create,
  update,
  remove,
} from './tenant.controller.js'

const router = Router()

// ── PUBLIC: Bootstrap ─────────────────────────────────────────
// No authentication — this is how a new tenant gets started.
// Must be before /:tenantId to avoid route collision.
router.post('/bootstrap', bootstrap)

// ── PROTECTED: All routes below require super_admin ───────────
// tenantGuard sets req.tenantId from JWT — for super_admin this
// will be null (they are not scoped to a tenant).
router.use(authenticate)
router.use(tenantGuard)
router.use(authorize(PERMISSIONS.MANAGE_TENANTS))

// GET    /api/v1/tenants
router.get('/', getAll)

// POST   /api/v1/tenants
router.post('/', create)

// GET    /api/v1/tenants/:tenantId
router.get(
  '/:tenantId',
  validateObjectId('tenantId'),
  getOne
)

// PATCH  /api/v1/tenants/:tenantId
router.patch(
  '/:tenantId',
  validateObjectId('tenantId'),
  update
)

// DELETE /api/v1/tenants/:tenantId
router.delete(
  '/:tenantId',
  validateObjectId('tenantId'),
  remove
)

export default router