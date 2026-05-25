// ============================================================
// modules/auth/auth.service.js
// All authentication business logic lives here.
// Controllers call service functions — they never contain logic.
//
// Responsibilities:
//   ✅ DB queries (find user, validate existence)
//   ✅ Password comparison
//   ✅ Token generation (access + refresh)
//   ✅ Refresh token verification and rotation
//   ✅ User sanitization before response
//   ❌ Does NOT handle req/res — that is controller territory
//   ❌ Does NOT set cookies — controller does that
// ============================================================

import User from '../../models/User.model.js'
import comparePassword from '../../utils/comparePassword.js'
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../../utils/generateToken.js'

// ── login ────────────────────────────────────────────────────

/**
 * Authenticates a user by email and password.
 * Returns a sanitized user object + both tokens.
 *
 * Security notes:
 *   - User is found by email first, tenant scope second.
 *   - passwordHash is explicitly selected (excluded by default in schema).
 *   - Generic error message used for both "not found" and "wrong password"
 *     to prevent user enumeration.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ user: Object, accessToken: string, refreshToken: string }}
 * @throws {Error} With status 401 on invalid credentials
 * @throws {Error} With status 403 on inactive account
 */
export const loginUser = async (email, password) => {
  // Select passwordHash explicitly — it is excluded by default in the schema
  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+passwordHash')
    .lean()

  if (!user) {
    const err = new Error('Invalid email or password')
    err.statusCode = 401
    throw err
  }

  const isMatch = await comparePassword(password, user.passwordHash)

  if (!isMatch) {
    const err = new Error('Invalid email or password')
    err.statusCode = 401
    throw err
  }

  if (!user.isActive) {
    const err = new Error('Your account has been deactivated. Contact your administrator.')
    err.statusCode = 403
    throw err
  }

  const tokenPayload = {
    userId:   user._id.toString(),
    tenantId: user.tenantId?.toString() ?? null,
    outletId: user.outletId?.toString() ?? null,
    role:     user.role,
  }

  const accessToken  = generateAccessToken(tokenPayload)
  const refreshToken = generateRefreshToken({
    userId:   tokenPayload.userId,
    tenantId: tokenPayload.tenantId,
  })

  return {
    user:         sanitizeUser(user),
    accessToken,
    refreshToken,
  }
}

// ── refreshAccessToken ───────────────────────────────────────

/**
 * Verifies a refresh token and issues a new access token.
 * Also rotates the refresh token (issues a new one).
 *
 * Rotation strategy: each refresh call returns a new refresh token.
 * The old one is considered consumed. In a future phase, a token
 * store (Redis) can enforce single-use refresh tokens.
 *
 * @param {string} refreshToken — from httpOnly cookie
 * @returns {{ accessToken: string, refreshToken: string, user: Object }}
 * @throws {Error} With status 401 on invalid or expired token
 */
export const refreshAccessToken = async (refreshToken) => {
  let decoded

  try {
    decoded = verifyRefreshToken(refreshToken)
  } catch {
    const err = new Error('Refresh token is invalid or has expired')
    err.statusCode = 401
    throw err
  }

  const user = await User.findById(decoded.userId).lean()

  if (!user) {
    const err = new Error('User no longer exists')
    err.statusCode = 401
    throw err
  }

  if (!user.isActive) {
    const err = new Error('Account is deactivated')
    err.statusCode = 403
    throw err
  }

  const tokenPayload = {
    userId:   user._id.toString(),
    tenantId: user.tenantId?.toString() ?? null,
    outletId: user.outletId?.toString() ?? null,
    role:     user.role,
  }

  const newAccessToken  = generateAccessToken(tokenPayload)
  const newRefreshToken = generateRefreshToken({
    userId:   tokenPayload.userId,
    tenantId: tokenPayload.tenantId,
  })

  return {
    user:         sanitizeUser(user),
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
  }
}

// ── getCurrentUser ───────────────────────────────────────────

/**
 * Fetches the authenticated user's current profile.
 * Used by GET /auth/me — user identity from req.user,
 * fresh data from DB.
 *
 * @param {string} userId — from req.user.userId
 * @returns {Object} Sanitized user
 * @throws {Error} With status 404 if user not found
 */
export const getCurrentUser = async (userId) => {
  const user = await User.findById(userId).lean()

  if (!user) {
    const err = new Error('User not found')
    err.statusCode = 404
    throw err
  }

  // Fix C3: deactivated users must not be able to fetch their own profile.
  // Their access token may still be valid (up to 15min TTL) but this
  // ensures /auth/me returns 403 immediately after deactivation.
  if (!user.isActive) {
    const err = new Error('Your account has been deactivated. Contact your administrator.')
    err.statusCode = 403
    throw err
  }

  return sanitizeUser(user)
}

// ── sanitizeUser ─────────────────────────────────────────────

/**
 * Strips sensitive fields before sending user data to the client.
 * passwordHash is NEVER returned — even if accidentally selected.
 *
 * @param {Object} user — raw user document from DB
 * @returns {Object} Safe user object
 */
const sanitizeUser = (user) => ({
  _id:      user._id,
  name:     user.name,
  email:    user.email,
  role:     user.role,
  tenantId: user.tenantId ?? null,
  outletId: user.outletId ?? null,
  isActive: user.isActive,
})