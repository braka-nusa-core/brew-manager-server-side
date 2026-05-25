// ============================================================
// modules/sales/sales.controller.js
// HTTP request/response layer for the sales module.
// Zero business logic — all logic is in sales.service.js.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateSale, validateUpdateSale } from './sales.validation.js'
import {
  createSale,
  getSales,
  getSaleById,
  updateSale,
  deleteSale,
  getEmployeeSalesSummary,
  getOutletSalesSummary,
} from './sales.service.js'

// ── POST /api/v1/sales ────────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateSale(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const sale = await createSale({
    tenantId: req.tenantId,
    user:     req.user,
    data:     req.body,
  })

  return res.status(201).json(successResponse('Sale recorded successfully', sale))
})

// ── GET /api/v1/sales ─────────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { sales, pagination } = await getSales({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json({
    success: true,
    message: 'Sales retrieved successfully',
    data:    sales,
    pagination,
  })
})

// ── GET /api/v1/sales/:saleId ─────────────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const sale = await getSaleById({
    tenantId: req.tenantId,
    user:     req.user,
    saleId:   req.params.saleId,
  })

  return res.status(200).json(successResponse('Sale retrieved successfully', sale))
})

// ── PATCH /api/v1/sales/:saleId ───────────────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateSale(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const sale = await updateSale({
    tenantId: req.tenantId,
    user:     req.user,
    saleId:   req.params.saleId,
    data:     req.body,
  })

  return res.status(200).json(successResponse('Sale updated successfully', sale))
})

// ── DELETE /api/v1/sales/:saleId ──────────────────────────────

export const remove = asyncHandler(async (req, res) => {
  await deleteSale({
    tenantId: req.tenantId,
    user:     req.user,
    saleId:   req.params.saleId,
  })

  return res.status(204).send()
})

// ── GET /api/v1/sales/summary/employee ────────────────────────

export const employeeSummary = asyncHandler(async (req, res) => {
  const data = await getEmployeeSalesSummary({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res
    .status(200)
    .json(successResponse('Employee sales summary retrieved', data))
})

// ── GET /api/v1/sales/summary/outlet ──────────────────────────

export const outletSummary = asyncHandler(async (req, res) => {
  const data = await getOutletSalesSummary({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res
    .status(200)
    .json(successResponse('Outlet sales summary retrieved', data))
})
