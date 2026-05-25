// ============================================================
// modules/sales/sales.service.js
// All sales business logic, DB queries, and aggregations.
//
// Design decisions:
//   - Employee existence is validated before creating a sale,
//     same pattern as attendance — outletId is derived from
//     the Employee record, not from the request body.
//   - Manager/cashier outlet restriction is enforced by
//     comparing employee.outletId against req.user.outletId.
//   - Aggregation pipelines use $match as the first stage
//     (always with tenantId) to leverage compound indexes.
//   - $lookup joins are kept minimal — only name fields are
//     pulled in for summary responses.
//   - Date normalization is applied consistently.
// ============================================================

import mongoose from 'mongoose'
import Sale     from '../../models/Sale.model.js'
import Employee from '../../models/Employee.model.js'
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

/**
 * Validates employee existence, tenant membership, and outlet scope.
 * Returns { employee } on success or { error } on failure.
 */
const validateEmployeeAccess = async (employeeId, tenantId, user) => {
  const employeeQuery = {}

  if (user.role !== ROLES.SUPER_ADMIN) {
    employeeQuery.tenantId = new mongoose.Types.ObjectId(tenantId)
  }
  employeeQuery._id = new mongoose.Types.ObjectId(employeeId)

  const employee = await Employee.findOne(employeeQuery).lean()

  if (!employee) {
    return { error: 'Employee not found or does not belong to this tenant' }
  }

  if (!employee.isActive) {
    return { error: 'Employee is inactive' }
  }

  // Manager and cashier are outlet-scoped
  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    employee.outletId.toString() !== user.outletId.toString()
  ) {
    return { error: 'Employee does not belong to your outlet' }
  }

  return { employee }
}

// ── createSale ────────────────────────────────────────────────

/**
 * Creates a new sale record.
 * outletId is derived from the validated Employee record.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - validated req.body
 * @returns {Promise<Object>} Created sale document
 */
export const createSale = async ({ tenantId, user, data }) => {
  const { employee, error } = await validateEmployeeAccess(
    data.employeeId,
    tenantId,
    user
  )

  if (error) {
    const err = new Error(error)
    err.statusCode = error.includes('not found') ? 404 : 403
    throw err
  }

  const sale = await Sale.create({
    tenantId:     new mongoose.Types.ObjectId(tenantId),
    outletId:     employee.outletId,           // from DB
    employeeId:   new mongoose.Types.ObjectId(data.employeeId),
    date:         normalizeDate(data.date),
    totalCups:    data.totalCups,
    totalRevenue: data.totalRevenue,
    notes:        data.notes?.trim() ?? null,
    recordedBy:   new mongoose.Types.ObjectId(user.userId),
  })

  return sale
}

// ── getSales ──────────────────────────────────────────────────

/**
 * Returns paginated sales records with optional filters.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.queryParams - req.query
 */
export const getSales = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  if (queryParams.outletId && user.role === ROLES.TENANT_ADMIN) {
    query.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.employeeId) {
    query.employeeId = new mongoose.Types.ObjectId(queryParams.employeeId)
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

  const [sales, total] = await Promise.all([
    Sale.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Sale.countDocuments(query),
  ])

  return {
    sales,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getSaleById ───────────────────────────────────────────────

export const getSaleById = async ({ tenantId, user, saleId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(saleId)

  const sale = await Sale.findOne(query).lean()

  if (!sale) {
    const err = new Error('Sale record not found')
    err.statusCode = 404
    throw err
  }

  return sale
}

// ── updateSale ────────────────────────────────────────────────

/**
 * Updates mutable fields on a sale record.
 * tenantId, outletId, employeeId are immutable.
 */
export const updateSale = async ({ tenantId, user, saleId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(saleId)

  const updateData = {}
  if (data.date         !== undefined) updateData.date         = normalizeDate(data.date)
  if (data.totalCups    !== undefined) updateData.totalCups    = data.totalCups
  if (data.totalRevenue !== undefined) updateData.totalRevenue = data.totalRevenue
  if (data.notes        !== undefined) updateData.notes        = data.notes?.trim() ?? null

  const sale = await Sale.findOneAndUpdate(
    query,
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!sale) {
    const err = new Error('Sale record not found')
    err.statusCode = 404
    throw err
  }

  return sale
}

// ── deleteSale ────────────────────────────────────────────────

export const deleteSale = async ({ tenantId, user, saleId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(saleId)

  const sale = await Sale.findOneAndDelete(query).lean()

  if (!sale) {
    const err = new Error('Sale record not found')
    err.statusCode = 404
    throw err
  }
}

// ── getEmployeeSalesSummary ───────────────────────────────────

/**
 * Aggregates sales totals grouped by employee.
 * Joins Employee collection to include employee name.
 *
 * Pipeline:
 *   $match (tenantId + outlet scope + date range)
 *   → $group by employeeId (sum cups + revenue)
 *   → $lookup Employee name
 *   → $project clean response shape
 *   → $sort by totalRevenue desc
 *
 * @param {Object} params
 * @param {string|null} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.queryParams - { outletId, startDate, endDate }
 * @returns {Promise<Object[]>}
 */
export const getEmployeeSalesSummary = async ({ tenantId, user, queryParams }) => {
  const matchStage = {}

  if (user.role !== ROLES.SUPER_ADMIN) {
    matchStage.tenantId = new mongoose.Types.ObjectId(tenantId)
  }

  // Outlet scope for manager/cashier
  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    user.outletId
  ) {
    matchStage.outletId = new mongoose.Types.ObjectId(user.outletId)
  } else if (queryParams.outletId) {
    matchStage.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  // Date range filter
  if (queryParams.startDate || queryParams.endDate) {
    matchStage.date = {}
    if (queryParams.startDate) matchStage.date.$gte = normalizeDate(queryParams.startDate)
    if (queryParams.endDate) {
      const end = normalizeDate(queryParams.endDate)
      end.setUTCHours(23, 59, 59, 999)
      matchStage.date.$lte = end
    }
  }

  const results = await Sale.aggregate([
    { $match: matchStage },

    {
      $group: {
        _id:          '$employeeId',
        totalCups:    { $sum: '$totalCups' },
        totalRevenue: { $sum: '$totalRevenue' },
      },
    },

    {
      $lookup: {
        from:         'employees',
        localField:   '_id',
        foreignField: '_id',
        as:           'employee',
      },
    },

    {
      $project: {
        _id:          0,
        employeeId:   '$_id',
        employeeName: { $arrayElemAt: ['$employee.name', 0] },
        totalCups:    1,
        totalRevenue: 1,
      },
    },

    { $sort: { totalRevenue: -1 } },
  ])

  return results
}

// ── getOutletSalesSummary ─────────────────────────────────────

/**
 * Aggregates sales totals grouped by outlet.
 * Joins Outlet collection for outlet name.
 *
 * Only accessible to tenant_admin and super_admin —
 * managers/cashiers see only their own outlet; a per-outlet
 * summary would be a single row and is not meaningful.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.queryParams - { startDate, endDate }
 * @returns {Promise<Object[]>}
 */
export const getOutletSalesSummary = async ({ tenantId, user, queryParams }) => {
  const matchStage = {}

  if (user.role !== ROLES.SUPER_ADMIN) {
    matchStage.tenantId = new mongoose.Types.ObjectId(tenantId)
  }

  // Manager/cashier: scope to their outlet for single-outlet summary
  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    user.outletId
  ) {
    matchStage.outletId = new mongoose.Types.ObjectId(user.outletId)
  }

  // Date range
  if (queryParams.startDate || queryParams.endDate) {
    matchStage.date = {}
    if (queryParams.startDate) matchStage.date.$gte = normalizeDate(queryParams.startDate)
    if (queryParams.endDate) {
      const end = normalizeDate(queryParams.endDate)
      end.setUTCHours(23, 59, 59, 999)
      matchStage.date.$lte = end
    }
  }

  const results = await Sale.aggregate([
    { $match: matchStage },

    {
      $group: {
        _id:          '$outletId',
        totalCups:    { $sum: '$totalCups' },
        totalRevenue: { $sum: '$totalRevenue' },
      },
    },

    {
      $lookup: {
        from:         'outlets',
        localField:   '_id',
        foreignField: '_id',
        as:           'outlet',
      },
    },

    {
      $project: {
        _id:        0,
        outletId:   '$_id',
        outletName: { $arrayElemAt: ['$outlet.name', 0] },
        totalCups:    1,
        totalRevenue: 1,
      },
    },

    { $sort: { totalRevenue: -1 } },
  ])

  return results
}
