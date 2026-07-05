// ============================================================
// modules/user/user.routes.js
// Mounted at: /api/v1/users
//
// Authorization matrix:
//   MANAGE_USERS → create, update, toggle-active, reset-password
//   VIEW_USERS   → (none — user management is admin-only)
//
// Only super_admin and tenant_admin have MANAGE_USERS.
// No other role can access any route in this module.
//
// ROUTE ORDER NOTE:
//   /:userId/toggle-active  must be before /:userId
//   /:userId/reset-password must be before /:userId
//   to prevent Express matching the segment as a userId value.
//
// Sprint 1 — User Management
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
  getOne,
  update,
  toggleActive,
  resetPassword,
} from './user.controller.js'

const router = Router()

// All user management routes require authentication + tenant context
router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/users ────────────────────────────────────────
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_USERS),
  create
)

// ── GET /api/v1/users ─────────────────────────────────────────
router.get(
  '/',
  authorize(PERMISSIONS.MANAGE_USERS),
  getAll
)

// ── PATCH /api/v1/users/:userId/toggle-active ─────────────────
// Must be registered before /:userId — specific path first
router.patch(
  '/:userId/toggle-active',
  validateObjectId('userId'),
  authorize(PERMISSIONS.MANAGE_USERS),
  toggleActive
)

// ── PATCH /api/v1/users/:userId/reset-password ───────────────
// Must be registered before /:userId — specific path first
router.patch(
  '/:userId/reset-password',
  validateObjectId('userId'),
  authorize(PERMISSIONS.MANAGE_USERS),
  resetPassword
)

// ── GET /api/v1/users/:userId ─────────────────────────────────
router.get(
  '/:userId',
  validateObjectId('userId'),
  authorize(PERMISSIONS.MANAGE_USERS),
  getOne
)

// ── PATCH /api/v1/users/:userId ───────────────────────────────
router.patch(
  '/:userId',
  validateObjectId('userId'),
  authorize(PERMISSIONS.MANAGE_USERS),
  update
)

export default router