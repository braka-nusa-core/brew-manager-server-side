// ============================================================
// modules/notification/notification.routes.js
// Defines all Notification Center endpoints.
// Applies middleware per route — not globally (matches
// auth.routes.js's style).
//
// Mounted at: /api/v1/notifications
//
// All routes below: authenticate required.
//
// Note: tenantGuard and authorize() are NOT applied anywhere in
// this file — approved decision. Access mirrors auth.routes.js's
// GET /me: identifying the user is enough, because every query in
// notification.service.js is scoped by req.user.userId alone, not
// by tenant or permission. There is no public create endpoint —
// notifications are only ever created by trigger functions called
// from other modules' services (payroll, bike), never via a route.
//
// Route order: literal sub-paths (/unread-count, /read-all) are
// registered before /:notificationId, per this codebase's
// universal convention (see e.g. cup.routes.js, bike.routes.js).
// ============================================================

import { Router } from 'express'
import {
  getAll,
  unreadCount,
  markRead,
  markAllRead,
  remove,
} from './notification.controller.js'
import authenticate     from '../../middlewares/authenticate.js'
import validateObjectId from '../../middlewares/validateObjectId.js'

const router = Router()

/**
 * GET /api/v1/notifications
 * Query: ?page, ?limit, ?isRead=true|false
 * Returns: { success, message, data: Notification[], pagination }
 */
router.get('/', authenticate, getAll)

/**
 * GET /api/v1/notifications/unread-count
 * Must be registered before /:notificationId.
 * Returns: { success, message, data: { count } }
 */
router.get('/unread-count', authenticate, unreadCount)

/**
 * PATCH /api/v1/notifications/read-all
 * Must be registered before /:notificationId.
 * Marks every unread notification owned by the caller as read.
 * Returns: { success, message, data: { matched, modified } }
 */
router.patch('/read-all', authenticate, markAllRead)

/**
 * PATCH /api/v1/notifications/:notificationId/read
 * Dedicated status-transition endpoint — matches this codebase's
 * convention (Bike /:id/status, CupRecord /finalize, etc.) of
 * never mutating status via a generic PATCH.
 */
router.patch(
  '/:notificationId/read',
  authenticate,
  validateObjectId('notificationId'),
  markRead
)

/**
 * DELETE /api/v1/notifications/:notificationId
 * Hard delete ("dismiss") — see Notification.model.js header note.
 */
router.delete(
  '/:notificationId',
  authenticate,
  validateObjectId('notificationId'),
  remove
)

export default router
