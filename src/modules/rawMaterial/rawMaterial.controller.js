// ============================================================
// modules/rawMaterial/rawMaterial.controller.js
// HTTP layer for raw material endpoints.
// Zero business logic — all logic in rawMaterial.service.js.
// tenantId always from req.tenantId (set by tenantGuard).
// Mirrors product.controller.js exactly.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateRawMaterial, validateUpdateRawMaterial } from './rawMaterial.validation.js'
import {
  createRawMaterial,
  getRawMaterials,
  getRawMaterialById,
  updateRawMaterial,
  softDeleteRawMaterial,
} from './rawMaterial.service.js'

// ── POST /api/v1/raw-materials ────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateRawMaterial(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const rawMaterial = await createRawMaterial(req.tenantId, req.body)

  return res.status(201).json(successResponse('Raw material created successfully', rawMaterial))
})

// ── GET /api/v1/raw-materials ─────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { rawMaterials, pagination } = await getRawMaterials(req.tenantId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Raw materials retrieved successfully',
    data:       rawMaterials,
    pagination,
  })
})

// ── GET /api/v1/raw-materials/:rawMaterialId ─────────────────

export const getOne = asyncHandler(async (req, res) => {
  const rawMaterial = await getRawMaterialById(req.tenantId, req.params.rawMaterialId)

  return res.status(200).json(successResponse('Raw material retrieved successfully', rawMaterial))
})

// ── PATCH /api/v1/raw-materials/:rawMaterialId ───────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateRawMaterial(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const rawMaterial = await updateRawMaterial(req.tenantId, req.params.rawMaterialId, req.body)

  return res.status(200).json(successResponse('Raw material updated successfully', rawMaterial))
})

// ── DELETE /api/v1/raw-materials/:rawMaterialId ──────────────
// Soft delete — sets isActive = false.
// Record is preserved for ProductRecipe history references.

export const remove = asyncHandler(async (req, res) => {
  await softDeleteRawMaterial(req.tenantId, req.params.rawMaterialId)

  return res.status(204).send()
})