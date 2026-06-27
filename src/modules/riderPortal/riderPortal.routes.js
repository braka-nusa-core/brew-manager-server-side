// ============================================================
// modules/riderPortal/riderPortal.routes.js
// Mounted at: /api/public/rider   (see app.js)
//
// DELIBERATELY NOT under /api/v1 — this is not a versioned
// business API surface, it is a distinct public namespace.
// Confirmed by the business requirement's own example URL shape
// and preserved rather than "corrected" to match /api/v1.
//
// NO authenticate. NO tenantGuard. NO authorize.
// The portal token IS the access credential — there is no other
// auth layer by design. This is the only route file in the
// codebase that intentionally omits the standard middleware chain.
//
// validateObjectId is NOT used here — the token is not a Mongo
// ObjectId. Its format ('rdr_' + base64url) is validated implicitly
// by the service's findOne() returning null for any malformed value,
// which already produces the correct generic 404.
//
// Rate limiting is applied at the app.js mount level
// (riderPortalRateLimiter), not inside this router — mirrors
// exactly how authRateLimiter is applied to /api/v1/auth in app.js,
// not inside auth.routes.js.
// ============================================================

import { Router } from 'express'
import { getPortal } from './riderPortal.controller.js'

const router = Router()

// GET /api/public/rider/:token
router.get('/:token', getPortal)

export default router