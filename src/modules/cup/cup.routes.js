// ============================================================
// modules/cup/cup.routes.js
// Mounted at: /api/v1/cups
//
// CRITICAL ROUTE ORDER — Express matches in registration order:
//   /reconciliation  MUST be before /:cupRecordId
//   /:cupRecordId/finalize  MUST be before /:cupRecordId
//   Failure to maintain order causes "reconciliation" or
//   "finalize" to be captured as a cupRecordId value.
//
// Authorization:
//   MANAGE_CUPS → create, update, finalize, delete
//   VIEW_CUPS   → list, detail, reconciliation
//
// Roles:
//   tenant_admin → full access
//   manager      → full access (manages daily cup operations)
//   cashier      → full access (records daily distributions)
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
  addRefill,
  finalize,
  remove,
  reconciliation,
} from './cup.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/cups ─────────────────────────────────────────
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_CUPS),
  create
)

// ── GET /api/v1/cups ──────────────────────────────────────────
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_CUPS, PERMISSIONS.MANAGE_CUPS),
  getAll
)

// ── GET /api/v1/cups/reconciliation ──────────────────────────
// MUST be before /:cupRecordId — prevents "reconciliation" being
// captured as a cupRecordId param value.
router.get(
  '/reconciliation',
  authorize(PERMISSIONS.VIEW_CUPS, PERMISSIONS.MANAGE_CUPS),
  reconciliation
)

// ── POST /api/v1/cups/:cupRecordId/refill ──────────────────────
// MUST be before /:cupRecordId — prevents "refill" being
// captured as a cupRecordId param value.
// One call = one refill event; draft records only (enforced in service).
router.post(
  '/:cupRecordId/refill',
  validateObjectId('cupRecordId'),
  authorize(PERMISSIONS.MANAGE_CUPS),
  addRefill
)

// ── PATCH /api/v1/cups/:cupRecordId/finalize ──────────────────
// MUST be before /:cupRecordId — prevents "finalize" being
// captured as a cupRecordId param value by the PATCH /:id route.
router.patch(
  '/:cupRecordId/finalize',
  validateObjectId('cupRecordId'),
  authorize(PERMISSIONS.MANAGE_CUPS),
  finalize
)

// ── GET /api/v1/cups/:cupRecordId ─────────────────────────────
router.get(
  '/:cupRecordId',
  validateObjectId('cupRecordId'),
  authorize(PERMISSIONS.VIEW_CUPS, PERMISSIONS.MANAGE_CUPS),
  getOne
)

// ── PATCH /api/v1/cups/:cupRecordId ──────────────────────────
// Draft records only — finalized records rejected in service.
router.patch(
  '/:cupRecordId',
  validateObjectId('cupRecordId'),
  authorize(PERMISSIONS.MANAGE_CUPS),
  update
)

// ── DELETE /api/v1/cups/:cupRecordId ─────────────────────────
// Hard delete — draft records only.
// Finalized records rejected in service (financial audit trail).
router.delete(
  '/:cupRecordId',
  validateObjectId('cupRecordId'),
  authorize(PERMISSIONS.MANAGE_CUPS),
  remove
)

export default router