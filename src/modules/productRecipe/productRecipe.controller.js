// ============================================================
// modules/productRecipe/productRecipe.controller.js
// HTTP layer for product recipe endpoints.
// Zero business logic — all logic in productRecipe.service.js.
//
// tenantId always from req.tenantId (set by tenantGuard).
// productId always from req.params.productId — validated by
// validateObjectId('productId') in the route layer before this
// runs (see productRecipe.routes.js for the mergeParams note).
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateUpsertRecipe } from './productRecipe.validation.js'
import { getRecipe, upsertRecipe, deleteRecipe } from './productRecipe.service.js'

// ── GET /api/v1/products/:productId/recipe ───────────────────

export const getOne = asyncHandler(async (req, res) => {
  const recipe = await getRecipe(req.tenantId, req.params.productId)

  return res.status(200).json(successResponse('Recipe retrieved successfully', recipe))
})

// ── PUT /api/v1/products/:productId/recipe ────────────────────
// Idempotent create-or-replace. Returns 201 on first creation,
// 200 when replacing an existing recipe.

export const upsert = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpsertRecipe(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const { recipe, isNew } = await upsertRecipe(req.tenantId, req.params.productId, req.body.items)

  const statusCode = isNew ? 201 : 200
  const message     = isNew ? 'Recipe created successfully' : 'Recipe updated successfully'

  return res.status(statusCode).json(successResponse(message, recipe))
})

// ── DELETE /api/v1/products/:productId/recipe ─────────────────

export const remove = asyncHandler(async (req, res) => {
  await deleteRecipe(req.tenantId, req.params.productId)

  return res.status(204).send()
})