// ============================================================
// modules/attendance/attendance.routes.js
// Route definitions for the attendance module.
//
// Mounted at: /api/v1/attendance
//
// IMPORTANT ROUTE ORDER:
//   POST /bulk must be declared BEFORE /:attendanceId
//   Otherwise Express matches "bulk" as an attendanceId param.
//
// Middleware stack on all routes:
//   authenticate  → verify JWT → req.user
//   tenantGuard   → scope tenant/outlet → req.tenantId
//   authorize()   → check RECORD_ATTENDANCE permission
//
// Routes:
//   POST    /                create single attendance
//   POST    /bulk            bulk create attendance
//   GET     /                list attendance (paginated + filtered)
//   GET     /:attendanceId   get single record
//   PATCH   /:attendanceId   update status/notes
//   DELETE  /:attendanceId   hard delete (for corrections)
// ============================================================

import { Router } from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  create,
  bulkCreate,
  getAll,
  getOne,
  update,
  remove,
} from './attendance.controller.js'

const router = Router()

// Apply authenticate + tenantGuard globally to all attendance routes
router.use(authenticate)
router.use(tenantGuard)

// ── POST /api/v1/attendance ───────────────────────────────────
router.post(
  '/',
  authorize(PERMISSIONS.RECORD_ATTENDANCE, PERMISSIONS.MANAGE_ATTENDANCE),
  create
)

// ── POST /api/v1/attendance/bulk ──────────────────────────────
// MUST be declared before /:attendanceId to prevent route collision
router.post(
  '/bulk',
  authorize(PERMISSIONS.RECORD_ATTENDANCE, PERMISSIONS.MANAGE_ATTENDANCE),
  bulkCreate
)

// ── GET /api/v1/attendance ────────────────────────────────────
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_ATTENDANCE, PERMISSIONS.RECORD_ATTENDANCE, PERMISSIONS.MANAGE_ATTENDANCE),
  getAll
)

// ── GET /api/v1/attendance/:attendanceId ──────────────────────
router.get(
  '/:attendanceId',
  validateObjectId('attendanceId'),
  authorize(PERMISSIONS.VIEW_ATTENDANCE, PERMISSIONS.RECORD_ATTENDANCE, PERMISSIONS.MANAGE_ATTENDANCE),
  getOne
)

// ── PATCH /api/v1/attendance/:attendanceId ────────────────────
router.patch(
  '/:attendanceId',
  validateObjectId('attendanceId'),
  authorize(PERMISSIONS.RECORD_ATTENDANCE, PERMISSIONS.MANAGE_ATTENDANCE),
  update
)

// ── DELETE /api/v1/attendance/:attendanceId ───────────────────
router.delete(
  '/:attendanceId',
  validateObjectId('attendanceId'),
  authorize(PERMISSIONS.RECORD_ATTENDANCE, PERMISSIONS.MANAGE_ATTENDANCE),
  remove
)

export default router