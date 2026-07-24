// ============================================================
// modules/inventory/inventory.routes.js
// Mounted at: /api/v1/inventory
//
// Sprint 6.2 — Production Batch & Inventory Management (write path).
// Sprint 6.3 — Inventory Management APIs (read-only reporting/browsing).
//
// Endpoints:
//   POST /production                      — record a new production batch
//   GET  /                                 — per-product stock overview (search/sort/paginate)
//   GET  /dashboard                        — tenant/outlet inventory summary
//   GET  /batches                          — list batches (paginated)
//   GET  /batches/:batchId                 — single batch detail
//   GET  /batches/:batchId/transactions    — full movement ledger for one batch
//   GET  /products/:productId              — single product's inventory detail
//   GET  /transactions                     — filterable/sortable transaction ledger
//
// No delete endpoint. No update endpoint — InventoryBatch is only ever
// mutated internally (by FIFO consumption / return / reject / production)
// via inventory.service.js, never directly through a public write endpoint.
//
// Authorization:
//   MANAGE_INVENTORY → create production batches
//   VIEW_INVENTORY   → every GET endpoint (MANAGE_INVENTORY also satisfies these)
//
// Roles (via ROLE_PERMISSIONS in constants/permissions.js):
//   tenant_admin → full access
//   manager      → full access
//   cashier      → view only
//   viewer       → view only
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  createProduction,
  getAll,
  getOne,
  getDashboard,
  getOverview,
  getProductDetail,
  getTransactions,
  getBatchTransactions,
} from './inventory.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// ── GET /api/v1/inventory/dashboard ─────────────────────────────
// MUST be registered before any parameterized route on this router.
router.get(
  '/dashboard',
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getDashboard
)

// ── GET /api/v1/inventory/transactions ───────────────────────────
router.get(
  '/transactions',
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getTransactions
)

// ── POST /api/v1/inventory/production ──────────────────────────
router.post(
  '/production',
  authorize(PERMISSIONS.MANAGE_INVENTORY),
  createProduction
)

// ── GET /api/v1/inventory/batches/:batchId/transactions ─────────
// MUST be registered before /batches/:batchId to avoid ambiguity.
router.get(
  '/batches/:batchId/transactions',
  validateObjectId('batchId'),
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getBatchTransactions
)

// ── GET /api/v1/inventory/batches ───────────────────────────────
router.get(
  '/batches',
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getAll
)

// ── GET /api/v1/inventory/batches/:batchId ──────────────────────
router.get(
  '/batches/:batchId',
  validateObjectId('batchId'),
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getOne
)

// ── GET /api/v1/inventory/products/:productId ────────────────────
router.get(
  '/products/:productId',
  validateObjectId('productId'),
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getProductDetail
)

// ── GET /api/v1/inventory ────────────────────────────────────────
// Root overview — MUST be registered last among GETs on this router
// (nothing else matches '/', so order relative to the others above
// doesn't strictly matter, but keeping it last mirrors "most general
// last" convention).
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY),
  getOverview
)

export default router