// ============================================================
// modules/production/production.controller.js
// Sprint 8.1 — Production Module.
//
// Zero business logic here — every function is a thin passthrough to
// modules/inventory/inventory.service.js (the SAME functions already
// used by /api/v1/inventory/production, /adjustments, /batches/:id).
// Validation reuses inventory.validation.js's existing
// validateCreateProduction unchanged (same request shape:
// { productId, quantity, producedAt, notes? } — this sprint's payload
// { productId, quantity, producedAt } is a strict subset of it).
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateProduction } from '../inventory/inventory.validation.js'
import {
  createProductionBatch,
  listProduction,
  getProductionById,
  getProductionDashboard,
} from '../inventory/inventory.service.js'

// ── POST /api/v1/production ─────────────────────────────────────

export const createProduction = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateProduction(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const batch = await createProductionBatch(
    req.tenantId,
    req.outletId,
    req.body,
    req.user.userId
  )

  return res.status(201).json(successResponse('Production batch recorded successfully', batch))
})

// ── GET /api/v1/production/dashboard ─────────────────────────────

export const getDashboard = asyncHandler(async (req, res) => {
  const summary = await getProductionDashboard(req.tenantId, req.outletId, req.query)
  return res.status(200).json(successResponse('Production dashboard retrieved successfully', summary))
})

// ── GET /api/v1/production ───────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { transactions, pagination } = await listProduction(req.tenantId, req.outletId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Production records retrieved successfully',
    data:       transactions,
    pagination,
  })
})

// ── GET /api/v1/production/:productionId ──────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const record = await getProductionById(req.tenantId, req.outletId, req.params.productionId)
  return res.status(200).json(successResponse('Production record retrieved successfully', record))
})