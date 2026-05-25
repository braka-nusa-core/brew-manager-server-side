// ============================================================
// modules/outlet/outlet.controller.js
// HTTP request/response layer for outlet endpoints.
// Zero business logic — all logic in outlet.service.js.
//
// tenantId always comes from req.tenantId (set by tenantGuard).
// Never from req.body.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateOutlet, validateUpdateOutlet } from './outlet.validation.js'
import {
  createOutlet,
  getOutlets,
  getOutletById,
  updateOutlet,
  softDeleteOutlet,
  toggleOutletActive,
} from './outlet.service.js'

// ── POST /api/v1/outlets ──────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateOutlet(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const outlet = await createOutlet(req.tenantId, req.body)

  return res.status(201).json(successResponse('Outlet created successfully', outlet))
})

// ── GET /api/v1/outlets ───────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { outlets, pagination } = await getOutlets(req.tenantId, req.user, req.query)

  return res.status(200).json({
    success: true,
    message: 'Outlets retrieved successfully',
    data:    outlets,
    pagination,
  })
})

// ── GET /api/v1/outlets/:outletId ─────────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const outlet = await getOutletById(req.tenantId, req.user, req.params.outletId)

  return res.status(200).json(successResponse('Outlet retrieved successfully', outlet))
})

// ── PATCH /api/v1/outlets/:outletId ──────────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateOutlet(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const outlet = await updateOutlet(req.tenantId, req.params.outletId, req.body)

  return res.status(200).json(successResponse('Outlet updated successfully', outlet))
})

// ── PATCH /api/v1/outlets/:outletId/toggle-active ────────────

export const toggleActive = asyncHandler(async (req, res) => {
  const outlet = await toggleOutletActive(req.tenantId, req.params.outletId)

  const message = outlet.isActive
    ? 'Outlet activated successfully'
    : 'Outlet deactivated successfully'

  return res.status(200).json(successResponse(message, outlet))
})

// ── DELETE /api/v1/outlets/:outletId ─────────────────────────
// Soft delete — sets deletedAt, preserves all operational data.

export const remove = asyncHandler(async (req, res) => {
  await softDeleteOutlet(req.tenantId, req.params.outletId)

  return res.status(204).send()
})