// ============================================================
// modules/inventory/inventory.controller.js
// HTTP request/response layer for Sprint 6.2 Inventory endpoints.
// Zero business logic — all logic in inventory.service.js.
//
// tenantId always from req.tenantId (set by tenantGuard).
// outletId always from req.outletId (set by tenantGuard) — NEVER from
// req.body, per the requirement that production is attributed to the
// authenticated user's outlet, not an arbitrary outlet chosen by the caller.
// userId always from req.user.userId (set by authenticate).
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateProduction } from './inventory.validation.js'
import {
  createProductionBatch,
  listBatches,
  getBatchById,
  getInventoryDashboard,
  getInventoryOverview,
  getProductInventoryDetail,
  listTransactions,
  listBatchTransactions,
} from './inventory.service.js'

// ── POST /api/v1/inventory/production ──────────────────────────

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

// ── GET /api/v1/inventory/batches ───────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { batches, pagination } = await listBatches(req.tenantId, req.outletId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Inventory batches retrieved successfully',
    data:       batches,
    pagination,
  })
})

// ── GET /api/v1/inventory/batches/:batchId ──────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const batch = await getBatchById(req.tenantId, req.outletId, req.params.batchId)
  return res.status(200).json(successResponse('Inventory batch retrieved successfully', batch))
})

// ============================================================
// Sprint 6.3 — Inventory Management APIs (read-only)
// ============================================================

// ── GET /api/v1/inventory/dashboard ─────────────────────────────

export const getDashboard = asyncHandler(async (req, res) => {
  const summary = await getInventoryDashboard(req.tenantId, req.outletId, req.query)
  return res.status(200).json(successResponse('Inventory dashboard retrieved successfully', summary))
})

// ── GET /api/v1/inventory ───────────────────────────────────────

export const getOverview = asyncHandler(async (req, res) => {
  const { products, pagination } = await getInventoryOverview(req.tenantId, req.outletId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Inventory overview retrieved successfully',
    data:       products,
    pagination,
  })
})

// ── GET /api/v1/inventory/products/:productId ───────────────────

export const getProductDetail = asyncHandler(async (req, res) => {
  const detail = await getProductInventoryDetail(
    req.tenantId, req.outletId, req.params.productId, req.query
  )
  return res.status(200).json(successResponse('Product inventory detail retrieved successfully', detail))
})

// ── GET /api/v1/inventory/transactions ───────────────────────────

export const getTransactions = asyncHandler(async (req, res) => {
  const { transactions, pagination } = await listTransactions(req.tenantId, req.outletId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Inventory transactions retrieved successfully',
    data:       transactions,
    pagination,
  })
})

// ── GET /api/v1/inventory/batches/:batchId/transactions ─────────

export const getBatchTransactions = asyncHandler(async (req, res) => {
  const { batch, transactions, pagination } = await listBatchTransactions(
    req.tenantId, req.outletId, req.params.batchId, req.query
  )

  return res.status(200).json({
    success:    true,
    message:    'Batch transaction history retrieved successfully',
    data:       transactions,
    batch,
    pagination,
  })
})