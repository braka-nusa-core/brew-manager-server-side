// ============================================================
// modules/dashboard/dashboard.controller.js
// HTTP request/response layer for the dashboard module.
// Zero business logic — all logic is in dashboard.service.js.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../utils/apiResponse.js'
import {
  getSummary,
  getSalesTrend,
  getExpenseTrend,
  getAttendanceSummary,
  getEmployeePerformance,
  getProductMargins,
  getDailyPaymentSummary,
} from './dashboard.service.js'

// ── GET /api/v1/dashboard/summary ────────────────────────────

export const summary = asyncHandler(async (req, res) => {
  const data = await getSummary({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json(successResponse('Dashboard summary retrieved', data))
})

// ── GET /api/v1/dashboard/sales-trend ────────────────────────

export const salesTrend = asyncHandler(async (req, res) => {
  const data = await getSalesTrend({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json(successResponse('Sales trend retrieved', data))
})

// ── GET /api/v1/dashboard/expense-trend ──────────────────────

export const expenseTrend = asyncHandler(async (req, res) => {
  const data = await getExpenseTrend({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json(successResponse('Expense trend retrieved', data))
})

// ── GET /api/v1/dashboard/attendance-summary ─────────────────

export const attendanceSummary = asyncHandler(async (req, res) => {
  const data = await getAttendanceSummary({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json(successResponse('Attendance summary retrieved', data))
})

// ── GET /api/v1/dashboard/employee-performance ───────────────

export const employeePerformance = asyncHandler(async (req, res) => {
  const data = await getEmployeePerformance({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json(successResponse('Employee performance retrieved', data))
})

// ── GET /api/v1/dashboard/product-margins ────────────────────
// Phase 5c addition. Simpler call shape than other handlers —
// getProductMargins only needs tenantId (no user/queryParams,
// since Product has no outlet scoping or date relevance).

export const productMargins = asyncHandler(async (req, res) => {
  const data = await getProductMargins(req.tenantId)

  return res.status(200).json(successResponse('Product margins retrieved', data))
})

// ── GET /api/v1/dashboard/daily-payment-summary (Phase 3.3) ────

export const dailyPaymentSummary = asyncHandler(async (req, res) => {
  const data = await getDailyPaymentSummary({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json(successResponse('Daily payment summary retrieved', data))
})