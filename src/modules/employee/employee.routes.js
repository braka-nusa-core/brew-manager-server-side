// ============================================================
// modules/employee/employee.routes.js
// Route definitions for the employee module.
// All routes are protected — no public employee endpoints.
// (The public Rider Portal lookup lives in its own module,
// riderPortal.routes.js, mounted separately in app.js — never here.)
//
// Mounted at: /api/v1/employees
//
// CRITICAL ROUTE ORDER:
//   /:employeeId/toggle-active and /:employeeId/generate-portal
//   MUST be registered BEFORE /:employeeId to prevent Express
//   matching "toggle-active"/"generate-portal" as an employeeId param.
//   Express evaluates routes in registration order — first match wins.
// ============================================================

import { Router } from 'express'
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
  remove,
  generatePortal,
} from './employee.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/employees ────────────────────────────────────
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  create
)

// ── GET /api/v1/employees ─────────────────────────────────────
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.MANAGE_EMPLOYEES),
  getAll
)

// ── PATCH /api/v1/employees/:employeeId/toggle-active ─────────
// MUST be before /:employeeId — Express matches in registration order.
// If /:employeeId is first, "toggle-active" is captured as the ID value.
router.patch(
  '/:employeeId/toggle-active',
  validateObjectId('employeeId'),
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  toggleActive
)

// ── POST /api/v1/employees/:employeeId/generate-portal ───────
// Phase 6A addition. Same route-order requirement as toggle-active
// above — registered before the bare /:employeeId routes.
router.post(
  '/:employeeId/generate-portal',
  validateObjectId('employeeId'),
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  generatePortal
)

// ── GET /api/v1/employees/:employeeId ─────────────────────────
router.get(
  '/:employeeId',
  validateObjectId('employeeId'),
  authorize(PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.MANAGE_EMPLOYEES),
  getOne
)

// ── PATCH /api/v1/employees/:employeeId ───────────────────────
router.patch(
  '/:employeeId',
  validateObjectId('employeeId'),
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  update
)

// ── DELETE /api/v1/employees/:employeeId ──────────────────────
router.delete(
  '/:employeeId',
  validateObjectId('employeeId'),
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  remove
)

export default router