// ============================================================
// modules/bike/bike.routes.js
// Mounted at: /api/v1/bikes
//
// CRITICAL ROUTE ORDER:
//   /maintenance MUST be registered BEFORE /:bikeId — mirrors
//   cup.routes.js's /reconciliation-before-/:cupRecordId and
//   payroll.routes.js's /generate-before-/:payrollId. Express
//   matches in registration order; first match wins.
//
// Authorization:
//   MANAGE_BIKES → create, update, status change, delete
//   VIEW_BIKES   → list, detail, maintenance dashboard
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
  updateStatus,
  remove,
  maintenance,
} from './bike.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// POST /api/v1/bikes
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_BIKES),
  create
)

// GET /api/v1/bikes
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_BIKES, PERMISSIONS.MANAGE_BIKES),
  getAll
)

// GET /api/v1/bikes/maintenance
// MUST be before /:bikeId.
router.get(
  '/maintenance',
  authorize(PERMISSIONS.VIEW_BIKES, PERMISSIONS.MANAGE_BIKES),
  maintenance
)

// GET /api/v1/bikes/:bikeId
router.get(
  '/:bikeId',
  validateObjectId('bikeId'),
  authorize(PERMISSIONS.VIEW_BIKES, PERMISSIONS.MANAGE_BIKES),
  getOne
)

// PATCH /api/v1/bikes/:bikeId
router.patch(
  '/:bikeId',
  validateObjectId('bikeId'),
  authorize(PERMISSIONS.MANAGE_BIKES),
  update
)

// PATCH /api/v1/bikes/:bikeId/status
router.patch(
  '/:bikeId/status',
  validateObjectId('bikeId'),
  authorize(PERMISSIONS.MANAGE_BIKES),
  updateStatus
)

// DELETE /api/v1/bikes/:bikeId  (soft delete)
router.delete(
  '/:bikeId',
  validateObjectId('bikeId'),
  authorize(PERMISSIONS.MANAGE_BIKES),
  remove
)

export default router