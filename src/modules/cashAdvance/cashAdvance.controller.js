// ============================================================
// modules/cashAdvance/cashAdvance.controller.js
// HTTP request/response layer for the Cash Advance module.
// Only create + list are exposed — no update/delete; each advance is
// an independently auditable, immutable record.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateCashAdvance, validateListQuery } from './cashAdvance.validation.js'
import { createCashAdvance, getCashAdvances } from './cashAdvance.service.js'

// ── POST /api/v1/cash-advances ──────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateCashAdvance(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const advance = await createCashAdvance({
    tenantId: req.tenantId,
    user:     req.user,
    data:     req.body,
  })

  return res.status(201).json(successResponse('Cash advance recorded successfully', advance))
})

// ── GET /api/v1/cash-advances ────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateListQuery(req.query)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const { advances, pagination } = await getCashAdvances({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json({
    success: true,
    message: 'Cash advances retrieved successfully',
    data:    advances,
    pagination,
  })
})