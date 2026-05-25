// ============================================================
// modules/expense/expense.controller.js
// HTTP request/response layer for the expense module.
// Zero business logic — all logic is in expense.service.js.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateExpense, validateUpdateExpense } from './expense.validation.js'
import {
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
} from './expense.service.js'

// ── POST /api/v1/expenses ─────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateExpense(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const expense = await createExpense({
    tenantId: req.tenantId,
    user:     req.user,
    data:     req.body,
  })

  return res.status(201).json(successResponse('Expense recorded successfully', expense))
})

// ── GET /api/v1/expenses ──────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { expenses, pagination } = await getExpenses({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json({
    success: true,
    message: 'Expenses retrieved successfully',
    data:    expenses,
    pagination,
  })
})

// ── GET /api/v1/expenses/:expenseId ───────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const expense = await getExpenseById({
    tenantId:  req.tenantId,
    user:      req.user,
    expenseId: req.params.expenseId,
  })

  return res.status(200).json(successResponse('Expense retrieved successfully', expense))
})

// ── PATCH /api/v1/expenses/:expenseId ─────────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateExpense(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const expense = await updateExpense({
    tenantId:  req.tenantId,
    user:      req.user,
    expenseId: req.params.expenseId,
    data:      req.body,
  })

  return res.status(200).json(successResponse('Expense updated successfully', expense))
})

// ── DELETE /api/v1/expenses/:expenseId ────────────────────────

export const remove = asyncHandler(async (req, res) => {
  await deleteExpense({
    tenantId:  req.tenantId,
    user:      req.user,
    expenseId: req.params.expenseId,
  })

  return res.status(204).send()
})
