// ============================================================
// modules/product/product.controller.js
// HTTP layer for product endpoints.
// Zero business logic — all logic in product.service.js.
// tenantId always from req.tenantId (set by tenantGuard).
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateProduct, validateUpdateProduct } from './product.validation.js'
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  softDeleteProduct,
  getProductMargin,
} from './product.service.js'

// ── POST /api/v1/products ─────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateProduct(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const product = await createProduct(req.tenantId, req.body)

  return res.status(201).json(successResponse('Product created successfully', product))
})

// ── GET /api/v1/products ──────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { products, pagination } = await getProducts(req.tenantId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Products retrieved successfully',
    data:       products,
    pagination,
  })
})

// ── GET /api/v1/products/:productId ──────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const product = await getProductById(req.tenantId, req.params.productId)

  return res.status(200).json(successResponse('Product retrieved successfully', product))
})

// ── PATCH /api/v1/products/:productId ────────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateProduct(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const product = await updateProduct(req.tenantId, req.params.productId, req.body)

  return res.status(200).json(successResponse('Product updated successfully', product))
})

// ── DELETE /api/v1/products/:productId ───────────────────────
// Soft delete — sets isActive = false.
// Product is preserved for CupRecord history references.

export const remove = asyncHandler(async (req, res) => {
  await softDeleteProduct(req.tenantId, req.params.productId)

  return res.status(204).send()
})

// ── GET /api/v1/products/:productId/margin ───────────────────
// Phase 5c addition. Margin computed from Product.sellingPrice
// and Product.cachedHPP only — no recipe lookup.

export const getMargin = asyncHandler(async (req, res) => {
  const margin = await getProductMargin(req.tenantId, req.params.productId)

  return res.status(200).json(successResponse('Product margin retrieved successfully', margin))
})