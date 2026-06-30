// ============================================================
// modules/notification/notification.controller.js
// Notification Center — MVP.
//
// authenticate-only access (see notification.routes.js). Every
// handler reads the recipient from req.user.userId — never from
// params/body/query — so a user can never address another
// user's notifications. Ownership is enforced again, redundantly,
// in notification.service.js.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../utils/apiResponse.js'
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from './notification.service.js'

// ── GET /api/v1/notifications ─────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { notifications, pagination } = await getNotifications(req.user.userId, req.query)

  return res.status(200).json({
    success: true,
    message: 'Notifications retrieved successfully',
    data: notifications,
    pagination,
  })
})

// ── GET /api/v1/notifications/unread-count ────────────────────

export const unreadCount = asyncHandler(async (req, res) => {
  const count = await getUnreadCount(req.user.userId)

  return res.status(200).json(
    successResponse('Unread count retrieved successfully', { count })
  )
})

// ── PATCH /api/v1/notifications/:notificationId/read ──────────

export const markRead = asyncHandler(async (req, res) => {
  const notification = await markAsRead(req.user.userId, req.params.notificationId)

  return res.status(200).json(
    successResponse('Notification marked as read', notification)
  )
})

// ── PATCH /api/v1/notifications/read-all ──────────────────────

export const markAllRead = asyncHandler(async (req, res) => {
  const result = await markAllAsRead(req.user.userId)

  return res.status(200).json(
    successResponse('All notifications marked as read', result)
  )
})

// ── DELETE /api/v1/notifications/:notificationId ──────────────

export const remove = asyncHandler(async (req, res) => {
  await deleteNotification(req.user.userId, req.params.notificationId)

  return res.status(204).send()
})
