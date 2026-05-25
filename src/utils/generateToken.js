// ============================================================
// utils/generateToken.js
// Responsible for creating signed JWTs only.
// No business logic. No DB access.
// ============================================================

import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

/**
 * Generates a short-lived JWT access token.
 *
 * Payload contains only what middleware needs:
 *   userId, tenantId, outletId, role
 *
 * Controllers never generate tokens directly —
 * they call auth.service.js which calls this util.
 *
 * @param {Object} payload
 * @param {string} payload.userId
 * @param {string} payload.tenantId
 * @param {string|null} payload.outletId
 * @param {string} payload.role
 * @returns {string} Signed JWT access token
 */
export const generateAccessToken = ({ userId, tenantId, outletId, role }) => {
  return jwt.sign(
    { userId, tenantId, outletId, role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES }
  )
}

/**
 * Generates a long-lived JWT refresh token.
 *
 * Payload is minimal — only userId and tenantId.
 * Role and outletId are NOT embedded to avoid
 * stale permission issues after role changes.
 * Fresh data is loaded when the token is refreshed.
 *
 * @param {Object} payload
 * @param {string} payload.userId
 * @param {string} payload.tenantId
 * @returns {string} Signed JWT refresh token
 */
export const generateRefreshToken = ({ userId, tenantId }) => {
  return jwt.sign(
    { userId, tenantId },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES }
  )
}

/**
 * Verifies and decodes an access token.
 * Throws if expired or invalid — caller handles the error.
 *
 * @param {string} token
 * @returns {Object} Decoded payload
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET)
}

/**
 * Verifies and decodes a refresh token.
 * Throws if expired or invalid — caller handles the error.
 *
 * @param {string} token
 * @returns {Object} Decoded payload
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET)
}
