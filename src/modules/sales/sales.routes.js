// ============================================================
// modules/sales/sales.routes.js
// Route definitions for the sales module.
// Mounted at: /api/v1/sales
//
// CRITICAL ROUTE ORDER:
//   /summary/employee and /summary/outlet MUST be declared
//   BEFORE /:saleId — otherwise Express treats "summary"
//   as a saleId parameter value.
//
// Authorization:
//   MANAGE_SALES  → create, update, delete
//   VIEW_SALES    → read (list, detail, summaries)
//
// Outlet scope:
//   Manager and cashier are auto-scoped in the service layer.
//   No route-level outlet filtering is needed.
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
  remove,
  employeeSummary,
  outletSummary,
} from './sales.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// ── Summary routes FIRST (before /:saleId) ───────────────────

router.get(
  '/summary/employee',
  authorize(PERMISSIONS.VIEW_SALES, PERMISSIONS.MANAGE_SALES),
  employeeSummary
)

router.get(
  '/summary/outlet',
  authorize(PERMISSIONS.VIEW_SALES, PERMISSIONS.MANAGE_SALES),
  outletSummary
)

// ── Standard CRUD ─────────────────────────────────────────────

router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_SALES),
  create
)

router.get(
  '/',
  authorize(PERMISSIONS.VIEW_SALES, PERMISSIONS.MANAGE_SALES),
  getAll
)

router.get(
  '/:saleId',
  validateObjectId('saleId'),
  authorize(PERMISSIONS.VIEW_SALES, PERMISSIONS.MANAGE_SALES),
  getOne
)

router.patch(
  '/:saleId',
  validateObjectId('saleId'),
  authorize(PERMISSIONS.MANAGE_SALES),
  update
)

router.delete(
  '/:saleId',
  validateObjectId('saleId'),
  authorize(PERMISSIONS.MANAGE_SALES),
  remove
)

export default router