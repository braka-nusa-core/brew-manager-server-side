// ============================================================
// modules/employeeWallet/employeeWallet.controller.js
// HTTP request/response layer for the Employee Wallet module.
// Phase 2.3: getSummary added, getHistory validated with
// validateHistoryQuery(). Phase 2.4: postManual added.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateEmployeeIdQuery,
  validateHistoryQuery,
  validateSummaryQuery,
  validateCreateWithdrawal,
  validateCreateAdjustment,
  validateManualEntry,
} from './employeeWallet.validation.js'
import {
  getCurrentBalance,
  createWithdrawal,
  createAdjustment,
  createManualEntry,
  listLedgerHistory,
  getWalletSummary,
} from './employeeWallet.service.js'

// ── GET /api/v1/wallet/balance?employeeId=... ────────────────

export const getBalance = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateEmployeeIdQuery(req.query)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const { employeeId } = req.query
  const balance = await getCurrentBalance(req.tenantId, employeeId)

  return res
    .status(200)
    .json(successResponse('Employee wallet balance retrieved successfully', { employeeId, balance }))
})

// ── GET /api/v1/wallet/history?employeeId=... ─────────────────

export const getHistory = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateHistoryQuery(req.query)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const { employeeId } = req.query
  const { entries, pagination } = await listLedgerHistory(req.tenantId, employeeId, req.query)

  return res.status(200).json({
    success: true,
    message: 'Employee wallet ledger history retrieved successfully',
    data:    entries,
    pagination,
  })
})

// ── GET /api/v1/wallet/summary?employeeId=...&startDate=...&endDate=... ──

export const getSummary = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateSummaryQuery(req.query)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const { employeeId, startDate, endDate } = req.query
  const summary = await getWalletSummary(req.tenantId, employeeId, { startDate, endDate })

  return res
    .status(200)
    .json(successResponse('Employee wallet summary retrieved successfully', summary))
})

// ── POST /api/v1/wallet/withdrawal ────────────────────────────

export const postWithdrawal = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateWithdrawal(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const entry = await createWithdrawal({
    tenantId:   req.tenantId,
    employeeId: req.body.employeeId,
    amount:     req.body.amount,
    date:       req.body.date,
    notes:      req.body.notes,
    createdBy:  req.user.userId,
  })

  return res.status(201).json(successResponse('Withdrawal recorded successfully', entry))
})

// ── POST /api/v1/wallet/adjustment ─────────────────────────────

export const postAdjustment = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateAdjustment(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const entry = await createAdjustment({
    tenantId:   req.tenantId,
    employeeId: req.body.employeeId,
    amount:     req.body.amount,
    date:       req.body.date,
    notes:      req.body.notes,
    createdBy:  req.user.userId,
  })

  return res.status(201).json(successResponse('Adjustment recorded successfully', entry))
})

// ── POST /api/v1/wallet/manual ──────────────────────────────────
// Phase 2.4.

export const postManual = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateManualEntry(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const entry = await createManualEntry({
    tenantId:   req.tenantId,
    employeeId: req.body.employeeId,
    type:       req.body.type,
    amount:     req.body.amount,
    date:       req.body.date,
    notes:      req.body.notes,
    createdBy:  req.user.userId,
  })

  return res.status(201).json(successResponse('Manual wallet transaction recorded successfully', entry))
})