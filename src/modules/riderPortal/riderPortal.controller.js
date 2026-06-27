// ============================================================
// modules/riderPortal/riderPortal.controller.js
// HTTP layer for the public Rider Portal endpoint.
// Zero business logic — all logic in riderPortal.service.js.
//
// No req.tenantId, no req.user — this is the one controller in
// the codebase that runs without authenticate/tenantGuard ahead
// of it. The token in the URL is the entire access credential.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../utils/apiResponse.js'
import { getRiderPortalData } from './riderPortal.service.js'

// ── GET /api/public/rider/:token ──────────────────────────────

export const getPortal = asyncHandler(async (req, res) => {
  const data = await getRiderPortalData(req.params.token)

  return res.status(200).json(successResponse('Rider portal data retrieved successfully', data))
})