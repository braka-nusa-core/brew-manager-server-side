// ============================================================
// modules/dashboard/dashboard.service.js
// All dashboard analytics via MongoDB aggregation pipelines.
//
// Design decisions:
//   - NO data is stored separately for analytics.
//     All results are computed on-demand from:
//     Sale, Expense, Attendance, Employee, Payroll collections.
//   - Every pipeline opens with $match as the FIRST stage.
//     This ensures compound indexes are used and collection
//     scans are avoided.
//   - Parallel execution: independent pipelines run via
//     Promise.all() — no sequential aggregation bottlenecks.
//   - Outlet scoping is applied inside matchStage helpers,
//     consistent with the pattern used across all modules.
//   - Date normalization to UTC midnight is applied to
//     startDate/endDate before being used in $match.
//   - All monetary values are returned as-is (no rounding
//     here — frontend handles display formatting).
// ============================================================

import mongoose from 'mongoose'
import Sale       from '../../models/Sale.model.js'
import Expense    from '../../models/Expense.model.js'
import Attendance from '../../models/Attendance.model.js'
import Employee   from '../../models/Employee.model.js'
import Product    from '../../models/Product.model.js'
import { ROLES }  from '../../constants/permissions.js'

// ── Helpers ───────────────────────────────────────────────────

/**
 * Normalizes a date to midnight UTC.
 */
const toUtcStart = (value) => {
  const d = new Date(value)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Normalizes a date to end of day UTC (23:59:59.999).
 */
const toUtcEnd = (value) => {
  const d = new Date(value)
  d.setUTCHours(23, 59, 59, 999)
  return d
}

/**
 * Builds a $match object for tenant + outlet scope.
 * Applies outletId from query if provided and permitted.
 * Manager is always locked to their own outletId.
 *
 * @param {string|null} tenantId
 * @param {Object} user
 * @param {Object} queryParams
 * @returns {Object} MongoDB $match filter
 */
const buildMatchScope = (tenantId, user, queryParams = {}) => {
  const match = {}

  if (user.role !== ROLES.SUPER_ADMIN) {
    match.tenantId = new mongoose.Types.ObjectId(tenantId)
  }

  // Manager is outlet-locked — always override with token outletId
  if (user.role === ROLES.MANAGER && user.outletId) {
    match.outletId = new mongoose.Types.ObjectId(user.outletId)
  } else if (
    queryParams.outletId &&
    user.role !== ROLES.MANAGER
  ) {
    match.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  return match
}

/**
 * Adds date range filter to an existing match object.
 * Mutates and returns the match object.
 */
const applyDateRange = (match, queryParams) => {
  if (queryParams.startDate || queryParams.endDate) {
    match.date = {}
    if (queryParams.startDate) match.date.$gte = toUtcStart(queryParams.startDate)
    if (queryParams.endDate)   match.date.$lte = toUtcEnd(queryParams.endDate)
  }
  return match
}

// ── getSummary ────────────────────────────────────────────────

/**
 * KPI Summary — aggregates core metrics in parallel.
 *
 * Returns:
 *   totalRevenue    — sum of Sale.totalRevenue
 *   totalExpense    — sum of Expense.amount
 *   netProfit       — totalRevenue - totalExpense
 *   totalCups       — sum of Sale.totalCups
 *   totalEmployees  — count of active employees in scope
 *   attendanceRate  — (present + late) / total records × 100
 *
 * @param {Object} params
 * @param {string|null} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.queryParams - { startDate, endDate, outletId }
 */
export const getSummary = async ({ tenantId, user, queryParams }) => {
  const scopeBase = buildMatchScope(tenantId, user, queryParams)

  const salesMatch      = applyDateRange({ ...scopeBase }, queryParams)
  const expenseMatch    = applyDateRange({ ...scopeBase }, queryParams)
  const attendanceMatch = applyDateRange({ ...scopeBase }, queryParams)

  // Employee count uses outletId scope but no date filter
  const employeeMatch = { ...scopeBase, isActive: true }
  delete employeeMatch.date

  const [salesAgg, expenseAgg, attendanceAgg, totalEmployees] = await Promise.all([

    // ── Sales: totalRevenue + totalCups ──
    Sale.aggregate([
      { $match: salesMatch },
      {
        $group: {
          _id:          null,
          totalRevenue: { $sum: '$totalRevenue' },
          totalCups:    { $sum: '$totalCups' },
        },
      },
    ]),

    // ── Expenses: totalExpense ──
    Expense.aggregate([
      { $match: expenseMatch },
      {
        $group: {
          _id:          null,
          totalExpense: { $sum: '$amount' },
        },
      },
    ]),

    // ── Attendance: present+late vs total ──
    Attendance.aggregate([
      { $match: attendanceMatch },
      {
        $group: {
          _id:          null,
          total:        { $sum: 1 },
          attended:     {
            $sum: {
              $cond: [
                { $in: ['$status', ['present', 'late']] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),

    // ── Employee count ──
    Employee.countDocuments(employeeMatch),
  ])

  const totalRevenue = salesAgg[0]?.totalRevenue  ?? 0
  const totalCups    = salesAgg[0]?.totalCups     ?? 0
  const totalExpense = expenseAgg[0]?.totalExpense ?? 0
  const netProfit    = totalRevenue - totalExpense

  const attendanceTotal   = attendanceAgg[0]?.total    ?? 0
  const attendancePresent = attendanceAgg[0]?.attended ?? 0
  const attendanceRate    = attendanceTotal > 0
    ? Math.round((attendancePresent / attendanceTotal) * 100 * 100) / 100
    : 0

  return {
    totalRevenue,
    totalExpense,
    netProfit,
    totalCups,
    totalEmployees,
    attendanceRate,       // percentage, 2 decimal places
  }
}

// ── getSalesTrend ─────────────────────────────────────────────

/**
 * Daily sales trend — groups revenue and cups by date.
 *
 * Pipeline:
 *   $match (scope + date range)
 *   → $group by date (sum revenue + cups)
 *   → $sort date ascending
 *   → $project clean date string + metrics
 *
 * @param {Object} params
 */
export const getSalesTrend = async ({ tenantId, user, queryParams }) => {
  const match = buildMatchScope(tenantId, user, queryParams)
  applyDateRange(match, queryParams)

  const results = await Sale.aggregate([
    { $match: match },

    {
      $group: {
        _id: {
          year:  { $year:  '$date' },
          month: { $month: '$date' },
          day:   { $dayOfMonth: '$date' },
        },
        totalRevenue: { $sum: '$totalRevenue' },
        totalCups:    { $sum: '$totalCups' },
      },
    },

    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },

    {
      $project: {
        _id:  0,
        date: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: {
              $dateFromParts: {
                year:  '$_id.year',
                month: '$_id.month',
                day:   '$_id.day',
              },
            },
          },
        },
        totalRevenue: 1,
        totalCups:    1,
      },
    },
  ])

  return results
}

// ── getExpenseTrend ───────────────────────────────────────────

/**
 * Daily expense trend — groups total expense by date.
 *
 * Pipeline:
 *   $match (scope + date range)
 *   → $group by date (sum amount)
 *   → $sort date ascending
 *   → $project clean date string
 *
 * @param {Object} params
 */
export const getExpenseTrend = async ({ tenantId, user, queryParams }) => {
  const match = buildMatchScope(tenantId, user, queryParams)
  applyDateRange(match, queryParams)

  const results = await Expense.aggregate([
    { $match: match },

    {
      $group: {
        _id: {
          year:  { $year:  '$date' },
          month: { $month: '$date' },
          day:   { $dayOfMonth: '$date' },
        },
        totalExpense: { $sum: '$amount' },
      },
    },

    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },

    {
      $project: {
        _id:  0,
        date: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: {
              $dateFromParts: {
                year:  '$_id.year',
                month: '$_id.month',
                day:   '$_id.day',
              },
            },
          },
        },
        totalExpense: 1,
      },
    },
  ])

  return results
}

// ── getAttendanceSummary ──────────────────────────────────────

/**
 * Attendance status breakdown — counts each status value.
 *
 * Pipeline:
 *   $match (scope + date range)
 *   → $group by status (count)
 *   → $project into named fields
 *
 * Result is always a flat object with all 5 status keys,
 * defaulting to 0 for statuses with no records.
 *
 * @param {Object} params
 */
export const getAttendanceSummary = async ({ tenantId, user, queryParams }) => {
  const match = buildMatchScope(tenantId, user, queryParams)
  applyDateRange(match, queryParams)

  const results = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id:   '$status',
        count: { $sum: 1 },
      },
    },
  ])

  // Build a guaranteed-complete flat object regardless of
  // which statuses have records in the period
  const summary = {
    present: 0,
    absent:  0,
    late:    0,
    leave:   0,
    holiday: 0,
    total:   0,
  }

  for (const row of results) {
    if (row._id in summary) {
      summary[row._id] = row.count
      summary.total   += row.count
    }
  }

  // attendanceRate derived here for convenience
  const attended = summary.present + summary.late
  summary.attendanceRate = summary.total > 0
    ? Math.round((attended / summary.total) * 100 * 100) / 100
    : 0

  return summary
}

// ── getEmployeePerformance ────────────────────────────────────

/**
 * Employee performance — joins sales and attendance per employee.
 *
 * Strategy:
 *   Run two independent aggregations in parallel:
 *     A) Sales grouped by employeeId (totalCups, totalRevenue)
 *     B) Attendance grouped by employeeId, status
 *
 *   Then merge in JS — this is more efficient than a $lookup
 *   between large aggregation results or a facet pipeline that
 *   loses index benefits on the second branch.
 *
 *   Finally, $lookup Employee name via a separate model query
 *   (one query, not per-employee).
 *
 * Returns employees sorted by totalRevenue descending.
 *
 * @param {Object} params
 */
export const getEmployeePerformance = async ({ tenantId, user, queryParams }) => {
  const scopeBase = buildMatchScope(tenantId, user, queryParams)

  const salesMatch      = applyDateRange({ ...scopeBase }, queryParams)
  const attendanceMatch = applyDateRange({ ...scopeBase }, queryParams)

  const [salesAgg, attendanceAgg] = await Promise.all([

    // A) Sales per employee
    Sale.aggregate([
      { $match: salesMatch },
      {
        $group: {
          _id:          '$employeeId',
          totalCups:    { $sum: '$totalCups' },
          totalRevenue: { $sum: '$totalRevenue' },
        },
      },
    ]),

    // B) Attendance per employee — count present and late separately
    Attendance.aggregate([
      { $match: attendanceMatch },
      {
        $group: {
          _id:               '$employeeId',
          attendancePresent: {
            $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] },
          },
          attendanceLate: {
            $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] },
          },
        },
      },
    ]),
  ])

  // Build lookup maps keyed by employeeId string for O(1) merge
  const salesMap      = new Map(salesAgg.map((r) => [r._id.toString(), r]))
  const attendanceMap = new Map(attendanceAgg.map((r) => [r._id.toString(), r]))

  // Union of all employeeIds that appear in either result
  const allEmployeeIds = new Set([
    ...salesMap.keys(),
    ...attendanceMap.keys(),
  ])

  if (allEmployeeIds.size === 0) return []

  // Fetch employee names in one query
  const employees = await Employee.find({
    _id: { $in: [...allEmployeeIds].map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id name')
    .lean()

  const nameMap = new Map(employees.map((e) => [e._id.toString(), e.name]))

  // Merge all data into final result array
  const performance = [...allEmployeeIds].map((id) => {
    const sale       = salesMap.get(id)
    const attendance = attendanceMap.get(id)

    return {
      employeeId:        id,
      employeeName:      nameMap.get(id) ?? 'Unknown',
      totalCups:         sale?.totalCups         ?? 0,
      totalRevenue:      sale?.totalRevenue      ?? 0,
      attendancePresent: attendance?.attendancePresent ?? 0,
      attendanceLate:    attendance?.attendanceLate    ?? 0,
    }
  })

  // Sort by totalRevenue descending
  performance.sort((a, b) => b.totalRevenue - a.totalRevenue)

  return performance
}

// ── getProductMargins ─────────────────────────────────────────
// Phase 5c addition.
//
// Intentionally NOT an aggregation pipeline — per approved
// architecture, this reads Product.find() directly and maps
// results in JS, since margin is already fully computable from
// fields already stored on each Product document (sellingPrice,
// cachedHPP). No $lookup, no Sale, no ProductRecipe involved.
//
// Signature is simpler than other dashboard functions (tenantId
// only, no user/queryParams) because Product has no outlet
// scoping and no date relevance — there is nothing to filter by
// beyond tenant and isActive.
//
// Returns ALL active products unconditionally — not filtered by
// recipe existence, cachedHPP value, or sellingPrice value. A
// product with no recipe/price yet still appears with zeroed
// margin fields, surfacing incomplete setup rather than hiding it.
//
// @param {string|null} tenantId
// @returns {Promise<Array>} array of margin DTOs

export const getProductMargins = async (tenantId) => {
  const filter = { isActive: true }
  if (tenantId) {
    filter.tenantId = new mongoose.Types.ObjectId(tenantId)
  }

  const products = await Product.find(filter)
    .sort({ name: 1 })
    .lean()

  return products.map((product) => {
    const sellingPrice = product.sellingPrice ?? 0
    const cachedHPP     = product.cachedHPP    ?? 0
    const marginAmount  = sellingPrice - cachedHPP
    const marginPercentage = sellingPrice > 0
      ? Math.round((marginAmount / sellingPrice) * 100)
      : 0

    return {
      productId:   product._id,
      productName: product.name,
      sellingPrice,
      cachedHPP,
      marginAmount,
      marginPercentage,
    }
  })
}

// ── getDailyPaymentSummary (Phase 3.3, extended Phase 3.4) ──────
//
// Read-only daily closing summary. NOT a "closing" workflow: no
// status field, no closedAt/closedBy, no locking, no approval. This
// only aggregates EXISTING data (Sale.totalRevenue/totalCups/
// paymentMethod, populated since Phase 3.2's CupRecord-finalize
// integration) — nothing is written, nothing prevents further
// CupRecord/Sale activity for the summarized outlet/date.
//
// Natural unit = outlet + date, matching the grouping already
// established by cup.service.js#getReconciliation (CupRecord
// quantities) and this file's own getSummary/getSalesTrend (Sale
// revenue).
//
// Phase 3.4: totalExpense + netRevenue added, reusing the exact
// Expense-aggregation pattern and match-scope already established in
// getSummary() above. NOT assumed to be cash-specific — Expense has
// no paymentMethod field, so totalExpense is only ever subtracted
// from totalRevenue (mirroring the existing
// netProfit = totalRevenue - totalExpense precedent), never from
// cashRevenue specifically. A day with expenses but zero Sale
// activity still appears (not silently dropped).
//
// Reuses buildMatchScope()/applyDateRange() verbatim — same
// tenant/outlet role-scoping as every other endpoint in this file.
//
// @param {Object} params
// @param {string|null} params.tenantId
// @param {Object} params.user
// @param {Object} params.queryParams - { startDate, endDate, outletId }
// @returns {Promise<Array>} one entry per {outletId, date} in scope
// (from Sale activity, Expense activity, or both)
export const getDailyPaymentSummary = async ({ tenantId, user, queryParams }) => {
  const match = applyDateRange(buildMatchScope(tenantId, user, queryParams), queryParams)

  const [saleResults, expenseResults] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: { outletId: '$outletId', date: '$date' },
          totalRevenue:       { $sum: '$totalRevenue' },
          totalCups:          { $sum: '$totalCups' },
          cashRevenue:        { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] },     '$totalRevenue', 0] } },
          transferRevenue:    { $sum: { $cond: [{ $eq: ['$paymentMethod', 'transfer'] }, '$totalRevenue', 0] } },
          qrisRevenue:        { $sum: { $cond: [{ $eq: ['$paymentMethod', 'qris'] },     '$totalRevenue', 0] } },
          // Sales with no paymentMethod set — either predates Phase 3.2's
          // finalize integration, or finalize was called without one.
          unspecifiedRevenue: { $sum: { $cond: [{ $eq: ['$paymentMethod', null] },       '$totalRevenue', 0] } },
          // Proxy for "number of finalized CupRecords" — Sale is
          // upserted 1:1 with each finalized CupRecord (origin: 'system'),
          // plus any manually-entered Sales in the same scope.
          recordCount:        { $sum: 1 },
          riderIds:           { $addToSet: '$employeeId' },
        },
      },
      { $addFields: { riderCount: { $size: '$riderIds' } } },
      {
        $project: {
          _id: 0,
          outletId:           '$_id.outletId',
          date:               '$_id.date',
          totalRevenue:       1,
          totalCups:          1,
          cashRevenue:        1,
          transferRevenue:    1,
          qrisRevenue:        1,
          unspecifiedRevenue: 1,
          recordCount:        1,
          riderCount:         1,
        },
      },
    ]),

    // Phase 3.4 — same outlet+date grouping, same match-scope pattern
    // already established for Expense in getSummary() above.
    Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: { outletId: '$outletId', date: '$date' },
          totalExpense: { $sum: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          outletId:     '$_id.outletId',
          date:         '$_id.date',
          totalExpense: 1,
        },
      },
    ]),
  ])

  // Merge Sale-based rows with Expense-based rows by {outletId, date} —
  // a day with expenses but zero Sale activity must still appear.
  const byKey = new Map()
  const keyOf = (outletId, date) => `${outletId}|${new Date(date).toISOString()}`

  for (const row of saleResults) {
    byKey.set(keyOf(row.outletId, row.date), {
      ...row,
      totalExpense: 0,
      netRevenue:   row.totalRevenue,
    })
  }

  for (const row of expenseResults) {
    const key = keyOf(row.outletId, row.date)
    const existing = byKey.get(key)
    if (existing) {
      existing.totalExpense = row.totalExpense
      existing.netRevenue   = existing.totalRevenue - row.totalExpense
    } else {
      byKey.set(key, {
        outletId:           row.outletId,
        date:               row.date,
        totalRevenue:       0,
        totalCups:          0,
        cashRevenue:        0,
        transferRevenue:    0,
        qrisRevenue:        0,
        unspecifiedRevenue: 0,
        recordCount:        0,
        riderCount:         0,
        totalExpense:       row.totalExpense,
        netRevenue:         -row.totalExpense,
      })
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const dateDiff = new Date(b.date) - new Date(a.date)
    return dateDiff !== 0 ? dateDiff : String(a.outletId).localeCompare(String(b.outletId))
  })
}