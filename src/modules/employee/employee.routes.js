// ============================================================
// modules/employee/employee.routes.js
// Route definitions for the employee module.
// All routes are protected — no public employee endpoints.
//
// Mounted at: /api/v1/employees
//
// Middleware stack applied to every route:
//   authenticate  → verifies JWT → req.user
//   tenantGuard   → scopes tenant/outlet → req.tenantId
//   authorize()   → checks role has required permission
//
// Routes:
//   POST    /                    create employee
//   GET     /                    list employees (paginated + filtered)
//   GET     /:employeeId         get single employee
//   PATCH   /:employeeId         update employee
//   PATCH   /:employeeId/toggle-active  toggle active status
//   DELETE  /:employeeId         soft delete employee
// ============================================================

import { Router } from 'express'
import authenticate from '../../middlewares/authenticate.js'
import tenantGuard  from '../../middlewares/tenantGuard.js'
import authorize    from '../../middlewares/authorize.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  create,
  getAll,
  getOne,
  update,
  toggleActive,
  remove,
} from './employee.controller.js'

const router = Router()

// Apply authenticate + tenantGuard to all employee routes.
// authorize() is applied per-route since different actions
// may require different permissions in future phases.
router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/employees ────────────────────────────────────
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  create
)

// ── GET /api/v1/employees ─────────────────────────────────────
// VIEW_EMPLOYEES allows read-only access (e.g. for future roles).
// MANAGE_EMPLOYEES also grants view access via permission check.
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.MANAGE_EMPLOYEES),
  getAll
)

// ── GET /api/v1/employees/:employeeId ─────────────────────────
router.get(
  '/:employeeId',
  authorize(PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.MANAGE_EMPLOYEES),
  getOne
)

// ── PATCH /api/v1/employees/:employeeId ───────────────────────
router.patch(
  '/:employeeId',
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  update
)

// ── PATCH /api/v1/employees/:employeeId/toggle-active ─────────
router.patch(
  '/:employeeId/toggle-active',
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  toggleActive
)

// ── DELETE /api/v1/employees/:employeeId ──────────────────────
// Soft delete — sets isActive = false.
// Hard delete is never performed.
router.delete(
  '/:employeeId',
  authorize(PERMISSIONS.MANAGE_EMPLOYEES),
  remove
)

export default router
