// ============================================================
// middlewares/authenticate.js
// Verifies the JWT access token on every protected route.
//
// Responsibilities:
//   ✅ Extract Bearer token from Authorization header
//   ✅ Verify JWT signature and expiry
//   ✅ Attach decoded payload to req.user
//   ✅ Reject missing, expired, or invalid tokens
//   ❌ Does NOT query the database
//   ❌ Does NOT validate tenant existence
//   ❌ Does NOT check roles
// ============================================================

import { verifyAccessToken } from '../utils/generateToken.js'
import { errorResponse } from '../utils/apiResponse.js'

/**
 * authenticate middleware
 *
 * Must be placed BEFORE tenantGuard and authorize on all
 * protected routes. Provides req.user to downstream middleware.
 *
 * req.user shape after successful verification:
 * {
 *   userId:   string,
 *   tenantId: string,
 *   outletId: string | null,
 *   role:     string
 * }
 */
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization

    // Authorization header must exist and use Bearer scheme
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json(errorResponse('Access token is required', 401))
    }

    const token = authHeader.split(' ')[1]

    if (!token) {
      return res
        .status(401)
        .json(errorResponse('Access token is malformed', 401))
    }

    // verifyAccessToken throws on expiry or invalid signature
    const decoded = verifyAccessToken(token)

    // Attach full decoded payload — downstream middleware
    // reads from req.user, never from req.body
    req.user = {
      userId:   decoded.userId,
      tenantId: decoded.tenantId,
      outletId: decoded.outletId ?? null,
      role:     decoded.role,
    }

    next()
  } catch (err) {
    // Distinguish expired vs malformed for better client handling
    if (err.name === 'TokenExpiredError') {
      return res
        .status(401)
        .json(errorResponse('Access token has expired', 401))
    }

    return res
      .status(401)
      .json(errorResponse('Access token is invalid', 401))
  }
}

export default authenticate
