// ============================================================
// modules/payroll/payroll.controller.js
// HTTP request/response layer for the payroll module.
// Zero business logic — all logic is in payroll.service.js.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateGeneratePayroll,
  validateAdjustPayroll,
} from './payroll.validation.js'
import {
  generatePayroll,
  getPayrolls,
  getPayrollById,
  approvePayroll,
  rejectPayroll,
  adjustPayroll,
  markPayrollPaid,
} from './payroll.service.js'

// ── POST /api/v1/payroll/generate ────────────────────────────

export const generate = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateGeneratePayroll(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const result = await generatePayroll({
    tenantId: req.tenantId,
    user:     req.user,
    data:     req.body,
  })

  const message = (result.generated === 0 && result.updated === 0)
    ? 'No payroll records generated — all employees already have locked payroll for this period'
    : `Payroll generated: ${result.generated} created, ${result.updated} updated, ${result.skipped} skipped`

  return res.status(201).json(successResponse(message, result))
})

// ── GET /api/v1/payroll ───────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { payrolls, pagination } = await getPayrolls({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json({
    success: true,
    message: 'Payroll records retrieved successfully',
    data:    payrolls,
    pagination,
  })
})

// ── GET /api/v1/payroll/:payrollId ────────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const payroll = await getPayrollById({
    tenantId:  req.tenantId,
    user:      req.user,
    payrollId: req.params.payrollId,
  })

  return res.status(200).json(successResponse('Payroll retrieved successfully', payroll))
})

// ── PATCH /api/v1/payroll/:payrollId/adjust ───────────────────

export const adjust = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateAdjustPayroll(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const payroll = await adjustPayroll({
    tenantId:  req.tenantId,
    user:      req.user,
    payrollId: req.params.payrollId,
    data:      req.body,
  })

  return res.status(200).json(successResponse('Payroll adjusted successfully', payroll))
})

// ── PATCH /api/v1/payroll/:payrollId/approve ──────────────────

export const approve = asyncHandler(async (req, res) => {
  const payroll = await approvePayroll({
    tenantId:  req.tenantId,
    user:      req.user,
    payrollId: req.params.payrollId,
  })

  return res.status(200).json(successResponse('Payroll approved successfully', payroll))
})

// ── PATCH /api/v1/payroll/:payrollId/reject ───────────────────

export const reject = asyncHandler(async (req, res) => {
  const payroll = await rejectPayroll({
    tenantId:  req.tenantId,
    user:      req.user,
    payrollId: req.params.payrollId,
  })

  return res.status(200).json(successResponse('Payroll reverted to draft', payroll))
})

// ── PATCH /api/v1/payroll/:payrollId/paid ─────────────────────

export const markPaid = asyncHandler(async (req, res) => {
  const payroll = await markPayrollPaid({
    tenantId:  req.tenantId,
    user:      req.user,
    payrollId: req.params.payrollId,
  })

  return res.status(200).json(successResponse('Payroll marked as paid', payroll))
})