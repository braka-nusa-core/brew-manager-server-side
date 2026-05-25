// ============================================================
// modules/expense/expense.service.js
// All expense business logic and DB operations.
//
// Design decisions:
//   - outletId is required in the request body for expenses
//     (unlike sales/attendance where it is derived from the
//     employee). Expenses are outlet-level, not employee-level.
//   - Manager/cashier outlet restriction: the submitted outletId
//     must match req.user.outletId.
//   - All queries are scoped by tenantId first.
//   - Date normalization to midnight UTC is applied consistently.
// ============================================================

import mongoose from 'mongoose'
import Expense  from '../../models/Expense.model.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'

// ── Helpers ───────────────────────────────────────────────────

const normalizeDate = (value) => {
  const d = new Date(value)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Builds the base MongoDB filter with tenant and outlet scope.
 * Manager and cashier are both outlet-scoped.
 */
const buildBaseQuery = (tenantId, user) => {
  const query = {}

  if (user.role === ROLES.SUPER_ADMIN) return query

  query.tenantId = new mongoose.Types.ObjectId(tenantId)

  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    user.outletId
  ) {
    query.outletId = new mongoose.Types.ObjectId(user.outletId)
  }

  return query
}

// ── createExpense ─────────────────────────────────────────────

/**
 * Creates an expense record.
 * Manager/cashier: submitted outletId must match their token outletId.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - validated req.body
 * @returns {Promise<Object>} Created expense document
 */
export const createExpense = async ({ tenantId, user, data }) => {
  // Outlet restriction for manager and cashier
  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    data.outletId !== user.outletId.toString()
  ) {
    const err = new Error('You can only record expenses for your own outlet')
    err.statusCode = 403
    throw err
  }

  const expense = await Expense.create({
    tenantId:    new mongoose.Types.ObjectId(tenantId),
    outletId:    new mongoose.Types.ObjectId(data.outletId),
    date:        normalizeDate(data.date),
    category:    data.category,
    description: data.description.trim(),
    amount:      data.amount,
    recordedBy:  new mongoose.Types.ObjectId(user.userId),
  })

  return expense
}

// ── getExpenses ───────────────────────────────────────────────

/**
 * Returns paginated expense records with optional filters.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.queryParams - req.query
 */
export const getExpenses = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  // outletId filter for tenant_admin
  if (
    queryParams.outletId &&
    user.role !== ROLES.MANAGER &&
    user.role !== ROLES.CASHIER
  ) {
    query.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.category) {
    query.category = queryParams.category
  }

  if (queryParams.startDate || queryParams.endDate) {
    query.date = {}
    if (queryParams.startDate) {
      query.date.$gte = normalizeDate(queryParams.startDate)
    }
    if (queryParams.endDate) {
      const end = normalizeDate(queryParams.endDate)
      end.setUTCHours(23, 59, 59, 999)
      query.date.$lte = end
    }
  }

  const [expenses, total] = await Promise.all([
    Expense.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Expense.countDocuments(query),
  ])

  return {
    expenses,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getExpenseById ────────────────────────────────────────────

export const getExpenseById = async ({ tenantId, user, expenseId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(expenseId)

  const expense = await Expense.findOne(query).lean()

  if (!expense) {
    const err = new Error('Expense record not found')
    err.statusCode = 404
    throw err
  }

  return expense
}

// ── updateExpense ─────────────────────────────────────────────

/**
 * Updates mutable fields on an expense record.
 * tenantId and outletId are immutable.
 */
export const updateExpense = async ({ tenantId, user, expenseId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(expenseId)

  const updateData = {}
  if (data.date        !== undefined) updateData.date        = normalizeDate(data.date)
  if (data.category    !== undefined) updateData.category    = data.category
  if (data.description !== undefined) updateData.description = data.description.trim()
  if (data.amount      !== undefined) updateData.amount      = data.amount

  const expense = await Expense.findOneAndUpdate(
    query,
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!expense) {
    const err = new Error('Expense record not found')
    err.statusCode = 404
    throw err
  }

  return expense
}

// ── deleteExpense ─────────────────────────────────────────────

export const deleteExpense = async ({ tenantId, user, expenseId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(expenseId)

  const expense = await Expense.findOneAndDelete(query).lean()

  if (!expense) {
    const err = new Error('Expense record not found')
    err.statusCode = 404
    throw err
  }
}
