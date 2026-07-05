// ============================================================
// modules/auth/auth.routes.js
// Defines all authentication endpoints.
// Applies middleware per route — not globally.
//
// Mounted at: /api/v1/auth
//
// Public routes (no auth required):
//   POST  /login
//   POST  /logout
//   POST  /refresh-token
//
// Protected routes (authenticate required):
//   GET   /me
//   PATCH /change-password   (Sprint 1 — self-service, any role)
// ============================================================

import { Router } from 'express'
import {
  login,
  logout,
  refreshToken,
  getMe,
  changePassword,
} from './auth.controller.js'
import authenticate from '../../middlewares/authenticate.js'

const router = Router()

// ── Public Routes ────────────────────────────────────────────

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 * Returns: { accessToken, user }
 * Sets: refreshToken httpOnly cookie
 */
router.post('/login', login)

/**
 * POST /api/v1/auth/logout
 * Clears the refreshToken cookie.
 * No body required.
 */
router.post('/logout', logout)

/**
 * POST /api/v1/auth/refresh-token
 * Reads refreshToken from httpOnly cookie.
 * Returns: { accessToken, user }
 * Rotates: refreshToken cookie
 */
router.post('/refresh-token', refreshToken)

// ── Protected Routes ─────────────────────────────────────────

/**
 * GET /api/v1/auth/me
 * Requires: Bearer access token in Authorization header
 * Returns: sanitized current user profile
 *
 * Note: tenantGuard is not applied here — /me only needs
 * to identify the user, not scope to a tenant resource.
 */
router.get('/me', authenticate, getMe)

/**
 * PATCH /api/v1/auth/change-password
 * Requires: Bearer access token (any role)
 * Body: { currentPassword, newPassword }
 *
 * Self-service password change. Verifies the current password
 * before accepting the new one. For admin-initiated password
 * reset (without knowing the current password), use:
 * PATCH /api/v1/users/:userId/reset-password
 *
 * Note: tenantGuard and authorize are not applied — this is a
 * self-service identity action, same pattern as /me.
 */
router.patch('/change-password', authenticate, changePassword)

export default router