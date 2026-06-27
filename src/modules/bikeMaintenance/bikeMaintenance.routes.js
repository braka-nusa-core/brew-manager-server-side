// ============================================================
// modules/bikeMaintenance/bikeMaintenance.routes.js
// Exports TWO routers, mounted at two separate base paths:
//   /api/v1/bike-damage-reports
//   /api/v1/bike-repair-records
//
// Both live in this one module folder per approved architecture
// (Question C: separate collections, same module) — the two
// base paths reflect the two distinct resources, not two modules.
//
// Authorization:
//   MANAGE_BIKES → create, status/update
//   VIEW_BIKES   → list
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  createDamage,
  getAllDamage,
  updateDamageStatus,
  createRepair,
  getAllRepair,
  updateRepair,
} from './bikeMaintenance.controller.js'

// ── Damage Report router ──────────────────────────────────────

const damageReportRouter = Router()

damageReportRouter.use(authenticate)
damageReportRouter.use(tenantGuard)

// POST /api/v1/bike-damage-reports
damageReportRouter.post(
  '/',
  authorize(PERMISSIONS.MANAGE_BIKES),
  createDamage
)

// GET /api/v1/bike-damage-reports
damageReportRouter.get(
  '/',
  authorize(PERMISSIONS.VIEW_BIKES, PERMISSIONS.MANAGE_BIKES),
  getAllDamage
)

// PATCH /api/v1/bike-damage-reports/:id/status
damageReportRouter.patch(
  '/:id/status',
  validateObjectId('id'),
  authorize(PERMISSIONS.MANAGE_BIKES),
  updateDamageStatus
)

// ── Repair Record router ──────────────────────────────────────

const repairRecordRouter = Router()

repairRecordRouter.use(authenticate)
repairRecordRouter.use(tenantGuard)

// POST /api/v1/bike-repair-records
repairRecordRouter.post(
  '/',
  authorize(PERMISSIONS.MANAGE_BIKES),
  createRepair
)

// GET /api/v1/bike-repair-records
repairRecordRouter.get(
  '/',
  authorize(PERMISSIONS.VIEW_BIKES, PERMISSIONS.MANAGE_BIKES),
  getAllRepair
)

// PATCH /api/v1/bike-repair-records/:id
repairRecordRouter.patch(
  '/:id',
  validateObjectId('id'),
  authorize(PERMISSIONS.MANAGE_BIKES),
  updateRepair
)

export { damageReportRouter, repairRecordRouter }