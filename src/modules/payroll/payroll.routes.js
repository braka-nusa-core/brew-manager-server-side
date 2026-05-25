// ============================================================
// modules/payroll/payroll.routes.js
// Route definitions for the payroll module.
// Mounted at: /api/v1/payroll
//
// CRITICAL ROUTE ORDER:
//   /generate must be declared BEFORE /:payrollId to prevent
//   Express from matching "generate" as a payrollId param.
//
// Authorization model:
//   MANAGE_PAYROLL → generate, approve, reject, adjust, paid
//   VIEW_PAYROLL   → list, detail
//
// Roles:
//   super_admin   → full access
//   tenant_admin  → full access
//   manager       → VIEW_PAYROLL only (their outlet)
//   cashier       → no access (not in permissions)
// ============================================================

import { Router } from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  generate,
  getAll,
  getOne,
  adjust,
  approve,
  reject,
  markPaid,
} from './payroll.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/payroll/generate ────────────────────────────
// MUST be declared before /:payrollId
router.post(
  '/generate',
  authorize(PERMISSIONS.MANAGE_PAYROLL),
  generate
)

// ── GET /api/v1/payroll ───────────────────────────────────────
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_PAYROLL, PERMISSIONS.MANAGE_PAYROLL),
  getAll
)

// ── GET /api/v1/payroll/:payrollId ────────────────────────────
router.get(
  '/:payrollId',
  validateObjectId('payrollId'),
  authorize(PERMISSIONS.VIEW_PAYROLL, PERMISSIONS.MANAGE_PAYROLL),
  getOne
)

// ── PATCH /api/v1/payroll/:payrollId/adjust ───────────────────
router.patch(
  '/:payrollId/adjust',
  validateObjectId('payrollId'),
  authorize(PERMISSIONS.MANAGE_PAYROLL),
  adjust
)

// ── PATCH /api/v1/payroll/:payrollId/approve ──────────────────
router.patch(
  '/:payrollId/approve',
  validateObjectId('payrollId'),
  authorize(PERMISSIONS.MANAGE_PAYROLL),
  approve
)

// ── PATCH /api/v1/payroll/:payrollId/reject ───────────────────
router.patch(
  '/:payrollId/reject',
  validateObjectId('payrollId'),
  authorize(PERMISSIONS.MANAGE_PAYROLL),
  reject
)

// ── PATCH /api/v1/payroll/:payrollId/paid ─────────────────────
router.patch(
  '/:payrollId/paid',
  validateObjectId('payrollId'),
  authorize(PERMISSIONS.MANAGE_PAYROLL),
  markPaid
)

export default router