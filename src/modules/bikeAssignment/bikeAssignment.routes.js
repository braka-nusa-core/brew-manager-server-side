// ============================================================
// modules/bikeAssignment/bikeAssignment.routes.js
// Mounted at: /api/v1/bike-assignments
//
// CRITICAL ROUTE ORDER:
//   /active MUST be registered BEFORE /:assignmentId — same
//   rationale as /maintenance before /:bikeId in bike.routes.js.
//
// Authorization:
//   MANAGE_BIKES → create, end
//   VIEW_BIKES   → list, active
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import { create, getAll, getActive, end } from './bikeAssignment.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// POST /api/v1/bike-assignments
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_BIKES),
  create
)

// GET /api/v1/bike-assignments
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_BIKES, PERMISSIONS.MANAGE_BIKES),
  getAll
)

// GET /api/v1/bike-assignments/active
// MUST be before /:assignmentId.
router.get(
  '/active',
  authorize(PERMISSIONS.VIEW_BIKES, PERMISSIONS.MANAGE_BIKES),
  getActive
)

// PATCH /api/v1/bike-assignments/:assignmentId/end
router.patch(
  '/:assignmentId/end',
  validateObjectId('assignmentId'),
  authorize(PERMISSIONS.MANAGE_BIKES),
  end
)

export default router