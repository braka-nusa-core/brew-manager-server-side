// ============================================================
// modules/production/production.routes.js
// Mounted at: /api/v1/production
//
// Sprint 8.1 — Production Module.
//
// Endpoints:
//   POST /            — record a new production batch
//   GET  /            — list production records (paginated/filterable)
//   GET  /:productionId — single production record (transaction + batch)
//
// This is a thin alias surface over the EXISTING inventory architecture —
// no new business logic, no new schema, no duplicated FIFO/batch/
// transaction handling. createProductionBatch/listProduction/
// getProductionById all live in modules/inventory/inventory.service.js
// and are reused verbatim (the same functions already power
// /api/v1/inventory/production and /api/v1/inventory/adjustments' pattern).
//
// Authorization: reuses the exact same permissions already used by
// /api/v1/inventory — no new permission was introduced.
//   MANAGE_INVENTORY → create production
//   VIEW_INVENTORY   → list, detail (MANAGE_INVENTORY also satisfies these)
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import { createProduction, getAll, getOne, getDashboard } from './production.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/production ─────────────────────────────────────
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_INVENTORY),
  createProduction
)

// ── GET /api/v1/production/dashboard ─────────────────────────────
// MUST be registered before /:productionId to avoid "dashboard" being
// captured as a productionId param value.
router.get(
  '/dashboard',
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getDashboard
)

// ── GET /api/v1/production ───────────────────────────────────────
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getAll
)

// ── GET /api/v1/production/:productionId ──────────────────────────
router.get(
  '/:productionId',
  validateObjectId('productionId'),
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getOne
)

export default router