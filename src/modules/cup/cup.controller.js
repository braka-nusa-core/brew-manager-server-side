// ============================================================
// modules/cup/cup.controller.js
// HTTP request/response layer for CupRecord endpoints.
// Zero business logic — all logic in cup.service.js.
//
// tenantId always from req.tenantId (set by tenantGuard).
// userId always from req.user.userId (set by authenticate).
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateCreateCupRecord,
  validateUpdateCupRecord,
} from './cup.validation.js'
import {
  createCupRecord,
  getCupRecords,
  getCupRecordById,
  updateCupRecord,
  finalizeCupRecord,
  deleteCupRecord,
  getReconciliation,
} from './cup.service.js'

// ── POST /api/v1/cups ─────────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateCupRecord(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const record = await createCupRecord(
    req.tenantId,
    req.outletId,
    req.body,
    req.user.userId
  )

  return res.status(201).json(successResponse('Cup record created successfully', record))
})

// ── GET /api/v1/cups ──────────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { records, pagination } = await getCupRecords(req.tenantId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Cup records retrieved successfully',
    data:       records,
    pagination,
  })
})

// ── GET /api/v1/cups/reconciliation ──────────────────────────
// MUST be registered before /:cupRecordId in routes to prevent
// Express matching "reconciliation" as a cupRecordId param.

export const reconciliation = asyncHandler(async (req, res) => {
  const results = await getReconciliation(req.tenantId, req.query)

  return res.status(200).json({
    success: true,
    message: 'Reconciliation data retrieved successfully',
    data:    results,
  })
})

// ── GET /api/v1/cups/:cupRecordId ─────────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const record = await getCupRecordById(req.tenantId, req.params.cupRecordId)

  return res.status(200).json(successResponse('Cup record retrieved successfully', record))
})

// ── PATCH /api/v1/cups/:cupRecordId ──────────────────────────
// Only draft records can be updated.

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateCupRecord(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const record = await updateCupRecord(
    req.tenantId,
    req.params.cupRecordId,
    req.body,
    req.user.userId
  )

  return res.status(200).json(successResponse('Cup record updated successfully', record))
})

// ── PATCH /api/v1/cups/:cupRecordId/finalize ──────────────────
// Validates per-product balance then locks the record.
// Returns 400 with detailed breakdown if any product is unbalanced.
// MUST be registered before /:cupRecordId in routes.

export const finalize = asyncHandler(async (req, res) => {
  const record = await finalizeCupRecord(
    req.tenantId,
    req.params.cupRecordId,
    req.user.userId
  )

  return res.status(200).json(
    successResponse('Cup record finalized successfully. All products are balanced.', record)
  )
})

// ── DELETE /api/v1/cups/:cupRecordId ─────────────────────────
// Hard delete — draft records only.
// Finalized records cannot be deleted (financial audit trail).

export const remove = asyncHandler(async (req, res) => {
  await deleteCupRecord(req.tenantId, req.params.cupRecordId)

  return res.status(204).send()
})