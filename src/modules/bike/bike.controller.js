// ============================================================
// modules/bike/bike.controller.js
// HTTP layer for bike endpoints. Zero business logic.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateCreateBike,
  validateUpdateBike,
  validateBikeStatus,
} from './bike.validation.js'
import {
  createBike,
  getBikes,
  getBikeById,
  updateBike,
  updateBikeStatus,
  softDeleteBike,
  getMaintenanceDashboard,
} from './bike.service.js'

// ── POST /api/v1/bikes ────────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateBike(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const bike = await createBike({ tenantId: req.tenantId, user: req.user, data: req.body })

  return res.status(201).json(successResponse('Bike created successfully', bike))
})

// ── GET /api/v1/bikes ─────────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { bikes, pagination } = await getBikes({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json({
    success:    true,
    message:    'Bikes retrieved successfully',
    data:       bikes,
    pagination,
  })
})

// ── GET /api/v1/bikes/maintenance ─────────────────────────────
// MUST be registered before /:bikeId in routes.

export const maintenance = asyncHandler(async (req, res) => {
  const data = await getMaintenanceDashboard({ tenantId: req.tenantId, user: req.user })

  return res.status(200).json(successResponse('Maintenance dashboard retrieved successfully', data))
})

// ── GET /api/v1/bikes/:bikeId ─────────────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const bike = await getBikeById({ tenantId: req.tenantId, user: req.user, bikeId: req.params.bikeId })

  return res.status(200).json(successResponse('Bike retrieved successfully', bike))
})

// ── PATCH /api/v1/bikes/:bikeId ───────────────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateBike(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const bike = await updateBike({
    tenantId: req.tenantId,
    user:     req.user,
    bikeId:   req.params.bikeId,
    data:     req.body,
  })

  return res.status(200).json(successResponse('Bike updated successfully', bike))
})

// ── PATCH /api/v1/bikes/:bikeId/status ────────────────────────

export const updateStatus = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateBikeStatus(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const bike = await updateBikeStatus({
    tenantId: req.tenantId,
    user:     req.user,
    bikeId:   req.params.bikeId,
    status:   req.body.status,
  })

  return res.status(200).json(successResponse('Bike status updated successfully', bike))
})

// ── DELETE /api/v1/bikes/:bikeId ──────────────────────────────
// Soft delete — sets isActive = false. Never hard delete.

export const remove = asyncHandler(async (req, res) => {
  await softDeleteBike({ tenantId: req.tenantId, user: req.user, bikeId: req.params.bikeId })

  return res.status(204).send()
})