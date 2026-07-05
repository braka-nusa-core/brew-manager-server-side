// ============================================================
// modules/user/user.controller.js
// HTTP request/response layer for User Management endpoints.
// Zero business logic — all logic lives in user.service.js.
//
// tenantId always comes from req.tenantId (set by tenantGuard).
// caller identity comes from req.user (set by authenticate).
// Neither ever comes from req.body.
//
// Sprint 1 — User Management
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateCreateUser,
  validateUpdateUser,
  validateResetPassword,
} from './user.validation.js'
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  toggleUserActive,
  resetUserPassword,
} from './user.service.js'

// ── POST /api/v1/users ────────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateUser(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const user = await createUser(req.tenantId, req.user, req.body)

  return res.status(201).json(successResponse('User created successfully', user))
})

// ── GET /api/v1/users ─────────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { users, pagination } = await getUsers(req.tenantId, req.user, req.query)

  return res.status(200).json({
    success: true,
    message: 'Users retrieved successfully',
    data:    users,
    pagination,
  })
})

// ── GET /api/v1/users/:userId ─────────────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const user = await getUserById(req.tenantId, req.user, req.params.userId)

  return res.status(200).json(successResponse('User retrieved successfully', user))
})

// ── PATCH /api/v1/users/:userId ───────────────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateUser(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const user = await updateUser(req.tenantId, req.user, req.params.userId, req.body)

  return res.status(200).json(successResponse('User updated successfully', user))
})

// ── PATCH /api/v1/users/:userId/toggle-active ─────────────────

export const toggleActive = asyncHandler(async (req, res) => {
  const user = await toggleUserActive(req.tenantId, req.user, req.params.userId)

  const message = user.isActive
    ? 'User account activated successfully'
    : 'User account deactivated successfully'

  return res.status(200).json(successResponse(message, user))
})

// ── PATCH /api/v1/users/:userId/reset-password ────────────────

export const resetPassword = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateResetPassword(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  await resetUserPassword(
    req.tenantId,
    req.user,
    req.params.userId,
    req.body.newPassword
  )

  return res.status(200).json(successResponse('Password reset successfully', null))
})