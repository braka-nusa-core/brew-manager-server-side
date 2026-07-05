// ============================================================
// modules/auth/auth.controller.js
// Handles HTTP request/response for auth endpoints.
// Contains ZERO business logic — all logic is in auth.service.js
//
// Responsibilities:
//   ✅ Parse req.body inputs
//   ✅ Call service functions
//   ✅ Set/clear httpOnly cookies
//   ✅ Send standardized responses
//   ❌ No DB access
//   ❌ No token generation
//   ❌ No business logic
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  loginUser,
  refreshAccessToken,
  getCurrentUser,
  changeOwnPassword,
} from './auth.service.js'
import { validateChangePassword } from '../user/user.validation.js'
import { env } from '../../config/env.js'

// ── Cookie Configuration ─────────────────────────────────────

/**
 * Builds the refresh token cookie options.
 * Extracted as a function so options are consistent
 * between login and token refresh.
 */
const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure:   env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  path:     '/api/v1/auth',           // Restrict cookie to auth routes only
})

// ── POST /api/v1/auth/login ──────────────────────────────────

/**
 * Authenticates the user.
 * Sets refresh token in httpOnly cookie.
 * Returns access token + sanitized user in response body.
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res
      .status(400)
      .json(errorResponse('Email and password are required', 400))
  }

  const { user, accessToken, refreshToken } = await loginUser(email, password)

  // Refresh token goes into a secure httpOnly cookie —
  // never in the response body, never accessible via JavaScript
  res.cookie('refreshToken', refreshToken, getRefreshCookieOptions())

  return res.status(200).json(
    successResponse('Login successful', {
      accessToken,
      user,
    })
  )
})

// ── POST /api/v1/auth/logout ─────────────────────────────────

/**
 * Clears the refresh token cookie.
 * Client is responsible for discarding the access token
 * from memory (Zustand store).
 */
export const logout = asyncHandler(async (req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure:   env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path:     '/api/v1/auth',
  })

  return res.status(200).json(successResponse('Logout successful', null))
})

// ── POST /api/v1/auth/refresh-token ─────────────────────────

/**
 * Issues a new access token using the refresh token from cookie.
 * Also rotates the refresh token — sets a fresh cookie.
 * Client should update the access token in memory on success.
 */
export const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken

  if (!token) {
    return res
      .status(401)
      .json(errorResponse('Refresh token is missing', 401))
  }

  const { user, accessToken, refreshToken: newRefreshToken } =
    await refreshAccessToken(token)

  // Rotate refresh token — set fresh cookie
  res.cookie('refreshToken', newRefreshToken, getRefreshCookieOptions())

  return res.status(200).json(
    successResponse('Token refreshed successfully', {
      accessToken,
      user,
    })
  )
})

// ── GET /api/v1/auth/me ──────────────────────────────────────

/**
 * Returns the currently authenticated user's profile.
 * Requires authenticate middleware — req.user is guaranteed.
 * Always fetches fresh data from DB, not just token payload.
 */
export const getMe = asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req.user.userId)

  return res.status(200).json(successResponse('User profile retrieved', user))
})

// ── PATCH /api/v1/auth/change-password ───────────────────────

/**
 * Self-service password change for the authenticated user.
 * Requires the user's current password — cannot be used to
 * reset a forgotten password. Admin password reset is at
 * PATCH /api/v1/users/:userId/reset-password.
 *
 * Requires: authenticate (any role)
 * Does NOT require: tenantGuard, authorize
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateChangePassword(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const { currentPassword, newPassword } = req.body

  await changeOwnPassword(req.user.userId, currentPassword, newPassword)

  return res.status(200).json(successResponse('Password changed successfully', null))
})