// ============================================================
// modules/payroll/payroll.service.js
// v2.0 — Phase 4: New payroll calculation engine.
//
// WHAT CHANGED FROM v1.0:
//   - generatePayroll() now reads Outlet config (payrollType,
//     commissionPercentage, mealAllowancePerDay, weeklyAttendanceBonus,
//     bonusRules[]) before the employee loop.
//   - Sale aggregate changed from single total to per-day grouped result.
//   - New commission branch: salaryEarned = revenue × commissionPercentage.
//     No base salary component for commission type.
//   - New fixed branch: existing formula preserved exactly.
//   - E14: effectivePresentDays = Math.min(presentDays, workingDays)
//     used for salary proration only. Meal allowance uses raw presentDays.
//   - Daily tier bonus evaluated per-day (not monthly aggregate).
//   - Weekly attendance bonus evaluated per-week with independence rule.
//   - adjustPayroll() now wires kasbon and uses updated calculateTotalPay().
//   - PAYROLL_CONFIG.BONUS_PER_CUP is no longer used. Bonus driven by
//     Outlet.bonusRules[]. cupsBonus set to 0 on all new records.
//
// WHAT DID NOT CHANGE:
//   - getPayrolls(), getPayrollById() — untouched
//   - approvePayroll(), rejectPayroll(), markPayrollPaid() — untouched
//   - Duplicate guard logic — untouched
//   - Batch insertMany pattern — untouched
//   - buildBaseQuery() — untouched
//   - getPeriodDateRange() — untouched
//   - calculateSalaryEarned() — untouched (called only from fixed branch)
//   - Status flow (draft → approved → paid) — untouched
//   - Paid payroll guard in adjustPayroll() — untouched
//
// E14 RULE:
//   effectivePresentDays = Math.min(presentDays, workingDays)
//   Used for salary proration (fixed type) ONLY.
//   Meal allowance uses raw presentDays from attendance records.
//
// BACKWARD COMPATIBILITY:
//   Old payroll records (pre-Phase 4) have null for new fields.
//   adjustPayroll() uses ?? 0 on all new fields to prevent NaN.
//   cupsBonus from old records is included in the adjustment
//   recalculation via ?? 0 so old totals are preserved correctly.
// ============================================================

import mongoose   from 'mongoose'
import Payroll    from '../../models/Payroll.model.js'
import Employee   from '../../models/Employee.model.js'
import Attendance from '../../models/Attendance.model.js'
import Sale       from '../../models/Sale.model.js'
import Outlet     from '../../models/Outlet.model.js'   // Phase 4: added
import ApiError   from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES }  from '../../constants/permissions.js'
// PAYROLL_CONFIG.BONUS_PER_CUP intentionally removed — Phase 4 uses Outlet.bonusRules[]

// ── Unchanged helpers ─────────────────────────────────────────

/**
 * Builds period start/end date range for a month/year.
 * Start: first millisecond of month (UTC)
 * End:   last millisecond of month (UTC)
 */
const getPeriodDateRange = (month, year) => {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const end   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  return { start, end }
}

/**
 * Calculates salary earned for fixed-type payroll.
 * E14: uses effectivePresentDays = Math.min(presentDays, workingDays)
 * so an employee can never earn more than 100% of prorated salary.
 *
 * @param {string} salaryType - 'monthly' | 'daily'
 * @param {number} baseSalary
 * @param {number} effectivePresentDays - already capped at workingDays
 * @param {number} workingDays
 * @returns {number}
 */
const calculateSalaryEarned = (salaryType, baseSalary, effectivePresentDays, workingDays) => {
  if (salaryType === 'monthly') {
    return Math.floor((baseSalary / workingDays) * effectivePresentDays)
  }
  // daily
  return Math.floor(baseSalary * effectivePresentDays)
}

/**
 * Builds tenant/outlet scoped base query for payroll reads.
 */
const buildBaseQuery = (tenantId, user) => {
  const query = {}
  if (user.role === ROLES.SUPER_ADMIN) return query
  query.tenantId = new mongoose.Types.ObjectId(tenantId)
  if (user.role === ROLES.MANAGER && user.outletId) {
    query.outletId = new mongoose.Types.ObjectId(user.outletId)
  }
  return query
}

// ── Phase 4 new helpers ───────────────────────────────────────

/**
 * Returns total days in a given month/year.
 * Used for Week 5 guard and period day iteration.
 *
 * @param {number} month - 1-12
 * @param {number} year
 * @returns {number} last day of month (28, 29, 30, or 31)
 */
const getLastDayOfMonth = (month, year) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * Returns an array of all calendar day strings (YYYY-MM-DD) in the period.
 * Used for daily tier bonus loop.
 *
 * @param {number} month - 1-12
 * @param {number} year
 * @returns {string[]} e.g. ['2026-05-01', '2026-05-02', ...]
 */
const getPeriodDays = (month, year) => {
  const lastDay = getLastDayOfMonth(month, year)
  const days = []
  for (let d = 1; d <= lastDay; d++) {
    const mm = String(month).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    days.push(`${year}-${mm}-${dd}`)
  }
  return days
}

/**
 * Builds a Map<dateString, { cups, revenue }> from the per-day
 * Sales aggregate result.
 *
 * @param {Array} salesAggResult - result from per-day $group aggregate
 * @returns {{ salesMap: Map, totalCups: number, totalRevenue: number }}
 */
const buildDailySalesMap = (salesAggResult) => {
  const salesMap    = new Map()
  let totalCups     = 0
  let totalRevenue  = 0

  for (const row of salesAggResult) {
    // _id.date is a Date object from the aggregate group key
    const dateStr = new Date(row._id.date).toISOString().split('T')[0]
    salesMap.set(dateStr, { cups: row.dailyCups, revenue: row.dailyRevenue })
    totalCups    += row.dailyCups
    totalRevenue += row.dailyRevenue
  }

  return { salesMap, totalCups, totalRevenue }
}

/**
 * Builds a Map<dateString, status> from attendance records.
 * Used for weekly bonus week-by-week evaluation.
 *
 * @param {Array} attendanceRecords
 * @returns {Map<string, string>}
 */
const buildAttendanceMap = (attendanceRecords) => {
  const map = new Map()
  for (const record of attendanceRecords) {
    const dateStr = new Date(record.date).toISOString().split('T')[0]
    map.set(dateStr, record.status)
  }
  return map
}

/**
 * Calculates daily tier bonus accumulated across all days in the period.
 * Evaluates per-day cups against outlet.bonusRules (sorted ascending).
 * Tiers are ADDITIVE — all qualifying tiers are summed per day.
 *
 * Example: 85 cups, rules=[{50:10000},{80:15000}]
 *   Day bonus = 10,000 + 15,000 = 25,000
 *
 * @param {Map}    salesMap   - Map<dateString, { cups, revenue }>
 * @param {Array}  bonusRules - [{ minCups, bonusAmount }] sorted ascending
 * @param {string[]} periodDays - all calendar day strings in period
 * @returns {{ totalBonus: number, bonusBreakdown: Array }}
 */
const calculateDailyTierBonus = (salesMap, bonusRules, periodDays) => {
  let totalBonus    = 0
  const bonusBreakdown = []

  // Sort ascending to ensure correct additive evaluation
  const sortedRules = [...bonusRules].sort((a, b) => a.minCups - b.minCups)

  for (const dayStr of periodDays) {
    const cupsSoldToday = salesMap.get(dayStr)?.cups ?? 0
    let dayBonus = 0

    for (const tier of sortedRules) {
      if (cupsSoldToday >= tier.minCups) {
        dayBonus += tier.bonusAmount
      }
    }

    totalBonus += dayBonus
    bonusBreakdown.push({
      date:     new Date(dayStr),
      cupsSold: cupsSoldToday,
      bonus:    dayBonus,
    })
  }

  return { totalBonus, bonusBreakdown }
}

/**
 * Calculates weekly attendance bonus for the payroll period.
 *
 * Week definitions (per confirmed business rules):
 *   Week 1: days  1– 7
 *   Week 2: days  8–14
 *   Week 3: days 15–21
 *   Week 4: days 22–28
 *   Week 5: days 29–end  (only if lastDayOfMonth >= 29)
 *
 * Qualification: ALL working days in week must have status IN ['present','late']
 * Independence:  each week evaluated separately — failed weeks do not cascade
 * Vacuous truth guard: a week with 0 attendance records is NOT qualified
 *
 * @param {Map}    attendanceMap     - Map<dateString, status>
 * @param {number} month             - 1-12
 * @param {number} year
 * @param {number} bonusPerWeek      - Outlet.weeklyAttendanceBonus
 * @returns {{ totalBonus: number, weeklyBonusBreakdown: Array }}
 */
const calculateWeeklyAttendanceBonus = (attendanceMap, month, year, bonusPerWeek) => {
  const QUALIFIED_STATUSES = ['present', 'late']
  const lastDay            = getLastDayOfMonth(month, year)
  const mm                 = String(month).padStart(2, '0')

  // Build week window definitions
  const weeks = [
    { weekNumber: 1, start: 1,  end: 7  },
    { weekNumber: 2, start: 8,  end: 14 },
    { weekNumber: 3, start: 15, end: 21 },
    { weekNumber: 4, start: 22, end: 28 },
  ]

  // Week 5 guard: only add if month has days beyond 28
  if (lastDay >= 29) {
    weeks.push({ weekNumber: 5, start: 29, end: lastDay })
  }

  let totalBonus             = 0
  const weeklyBonusBreakdown = []

  for (const week of weeks) {
    // Collect all attendance records that fall within this week window
    const workingDaysInWeek = []

    for (let d = week.start; d <= Math.min(week.end, lastDay); d++) {
      const dd      = String(d).padStart(2, '0')
      const dateStr = `${year}-${mm}-${dd}`
      if (attendanceMap.has(dateStr)) {
        workingDaysInWeek.push({ dateStr, status: attendanceMap.get(dateStr) })
      }
    }

    // Vacuous truth guard: 0 records = not qualified
    const qualified =
      workingDaysInWeek.length > 0 &&
      workingDaysInWeek.every((d) => QUALIFIED_STATUSES.includes(d.status))

    const bonus = qualified ? bonusPerWeek : 0
    totalBonus += bonus

    weeklyBonusBreakdown.push({
      weekNumber: week.weekNumber,
      qualified,
      bonus,
    })
  }

  return { totalBonus, weeklyBonusBreakdown }
}

/**
 * Calculates totalPay from all components.
 * Uses ?? 0 on every field to handle pre-Phase-4 records that have null.
 * Ensures totalPay is never negative (clamped to 0).
 * Applies Math.floor to eliminate fractional currency.
 *
 * Replaces old calculateTotalPay(a, b, c, d) — now takes full payroll object.
 *
 * @param {Object} p - payroll document (or plain object with all fields)
 * @returns {number}
 */
const calculateTotalPay = (p) =>
  Math.max(
    0,
    Math.floor(
      (p.salaryEarned          ?? 0)
      + (p.cupsBonus             ?? 0)   // legacy field — 0 on new records, preserved for old
      + (p.mealAllowanceTotal    ?? 0)
      + (p.dailyTierBonus        ?? 0)
      + (p.weeklyAttendanceBonus ?? 0)
      + (p.manualBonus           ?? 0)
      - (p.deductions            ?? 0)
      - (p.kasbon                ?? 0)
    )
  )

// ── generatePayroll ───────────────────────────────────────────

/**
 * Generates payroll records for all active employees in an outlet
 * for a given month/year period.
 *
 * Phase 4 generation steps per employee:
 *   0. Fetch outlet config (payrollType, commissionPercentage, bonusRules, etc.)
 *   1. Pull attendance records → build attendanceMap
 *   2. Count presentDays, absentDays
 *   3. Apply E14: effectivePresentDays = Math.min(presentDays, workingDays)
 *   4. Pull per-day sales aggregate → build dailySalesMap
 *   5. Branch on outlet.payrollType:
 *      COMMISSION: salaryEarned = riderRevenue × commissionPercentage / 100
 *      FIXED:      salaryEarned = existing proration formula (with effectivePresentDays)
 *   6. Calculate mealAllowanceTotal (both types, uses raw presentDays)
 *   7. Calculate dailyTierBonus (both types, per-day evaluation)
 *   8. Calculate weeklyAttendanceBonus (both types, per-week evaluation)
 *   9. Build payroll document with all fields
 *  10. Batch insert
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - { outletId, month, year, workingDays }
 */
export const generatePayroll = async ({ tenantId, user, data }) => {
  const { outletId, month, year, workingDays } = data
  const numMonth       = Number(month)
  const numYear        = Number(year)
  const numWorkingDays = Number(workingDays)

  const tenantOid = user.role !== ROLES.SUPER_ADMIN
    ? new mongoose.Types.ObjectId(tenantId)
    : null
  const outletOid = new mongoose.Types.ObjectId(outletId)

  const { start, end } = getPeriodDateRange(numMonth, numYear)

  // ── Step 0: Fetch outlet config (Phase 4 — runs once before employee loop) ──

  const outlet = await Outlet.findOne({
    _id:       outletOid,
    isActive:  true,
    deletedAt: null,
    ...(tenantOid ? { tenantId: tenantOid } : {}),
  }).lean()

  if (!outlet) {
    throw new ApiError(404, 'Outlet not found or is inactive')
  }

  // Destructure payroll config with safe defaults
  const payrollType            = outlet.payrollType            ?? 'fixed'
  const commissionPercentage   = outlet.commissionPercentage   ?? 0
  const mealAllowancePerDay    = outlet.mealAllowancePerDay    ?? 0
  const weeklyBonusAmount      = outlet.weeklyAttendanceBonus  ?? 0
  // Sort bonus rules ascending by minCups — never trust client ordering
  const bonusRules             = [...(outlet.bonusRules ?? [])].sort((a, b) => a.minCups - b.minCups)

  // Pre-compute period calendar days for tier bonus loop
  const periodDays = getPeriodDays(numMonth, numYear)

  // ── Fetch employees ───────────────────────────────────────────

  const employeeQuery = { outletId: outletOid, isActive: true }
  if (tenantOid) employeeQuery.tenantId = tenantOid

  const employees = await Employee.find(employeeQuery).lean()

  if (employees.length === 0) {
    return { generated: 0, skipped: 0, skippedItems: [] }
  }

  const skippedItems = []
  const payrollDocs  = []

  // ── Per-employee loop ─────────────────────────────────────────

  for (const employee of employees) {
    const employeeOid = employee._id

    // ── Duplicate guard ───────────────────────────────────────
    const existingQuery = {
      employeeId:     employeeOid,
      'period.month': numMonth,
      'period.year':  numYear,
    }
    if (tenantOid) existingQuery.tenantId = tenantOid

    const existing = await Payroll.findOne(existingQuery).lean()
    if (existing) {
      skippedItems.push({
        employeeId:   employeeOid.toString(),
        employeeName: employee.name,
        reason:       `Payroll already exists with status '${existing.status}'`,
      })
      continue
    }

    // ── Step 1–2: Attendance ──────────────────────────────────
    const attendanceRecords = await Attendance.find({
      ...(tenantOid ? { tenantId: tenantOid } : {}),
      employeeId: employeeOid,
      date:       { $gte: start, $lte: end },
    }).lean()

    let presentDays = 0
    let absentDays  = 0

    for (const record of attendanceRecords) {
      if (record.status === 'present' || record.status === 'late') {
        presentDays++
      } else {
        absentDays++
      }
    }

    // ── Step 3: E14 cap ───────────────────────────────────────
    // effectivePresentDays used for salary proration ONLY.
    // Raw presentDays used for mealAllowanceTotal (intentional — see E14 decision).
    const effectivePresentDays = Math.min(presentDays, numWorkingDays)

    // ── Step 4: Per-day sales aggregate ──────────────────────
    // Phase 4: group by date to enable per-day tier bonus evaluation.
    // Old: { _id: null, totalCupsSold: $sum } — single number
    // New: { _id: { date }, dailyCups: $sum, dailyRevenue: $sum } — per day
    const salesAggResult = await Sale.aggregate([
      {
        $match: {
          ...(tenantOid ? { tenantId: tenantOid } : {}),
          employeeId: employeeOid,
          date:       { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id:          { date: '$date' },
          dailyCups:    { $sum: '$totalCups' },
          dailyRevenue: { $sum: '$totalRevenue' },
        },
      },
      { $sort: { '_id.date': 1 } },
    ])

    const { salesMap, totalCups: totalCupsSold, totalRevenue } =
      buildDailySalesMap(salesAggResult)

    // ── Step 5: Branch on payrollType ─────────────────────────

    let salaryEarned = 0
    let commission   = 0

    if (payrollType === 'commission') {
      // Commission type: no base salary.
      // Income = commission + allowances + bonuses.
      commission   = Math.floor(totalRevenue * (commissionPercentage / 100))
      salaryEarned = commission
    } else {
      // Fixed type: existing proration formula, E14 cap applied.
      salaryEarned = calculateSalaryEarned(
        employee.salaryType,
        employee.baseSalary,
        effectivePresentDays,  // E14: capped at workingDays
        numWorkingDays
      )
    }

    // ── Step 6: Meal allowance (both types, raw presentDays) ──
    const mealAllowanceTotal = Math.floor(mealAllowancePerDay * presentDays)

    // ── Step 7: Daily tier bonus (both types, per-day evaluation) ──
    const { totalBonus: dailyTierBonus, bonusBreakdown } =
      calculateDailyTierBonus(salesMap, bonusRules, periodDays)

    // ── Step 8: Weekly attendance bonus (both types) ──────────
    const attendanceMap = buildAttendanceMap(attendanceRecords)
    const { totalBonus: weeklyAttendanceBonus, weeklyBonusBreakdown } =
      calculateWeeklyAttendanceBonus(attendanceMap, numMonth, numYear, weeklyBonusAmount)

    // ── Step 9: Build payroll document ────────────────────────
    const payrollFields = {
      salaryEarned,
      cupsBonus:             0,            // legacy field — explicitly 0 on Phase 4 records
      mealAllowanceTotal,
      dailyTierBonus,
      weeklyAttendanceBonus,
      manualBonus:           0,
      deductions:            0,
      kasbon:                0,
    }

    const totalPay = calculateTotalPay(payrollFields)

    payrollDocs.push({
      tenantId:     tenantOid ?? undefined,
      outletId:     outletOid,
      employeeId:   employeeOid,
      period:       { month: numMonth, year: numYear },

      // ── Snapshot: employee state at generation time ──
      salaryType:   employee.salaryType,
      baseSalary:   employee.baseSalary,  // preserved for reference; NOT used for commission type
      payrollType,                         // outlet config snapshot

      // ── Attendance summary ──
      workingDays:  numWorkingDays,
      presentDays,                         // raw count (for display and mealAllowance)
      absentDays,

      // ── Sales summary ──
      totalCupsSold,

      // ── Calculated earnings ──
      commission,                          // 0 for fixed type
      salaryEarned,
      cupsBonus:             0,            // legacy field — 0 on Phase 4 records
      mealAllowanceTotal,
      dailyTierBonus,
      weeklyAttendanceBonus,

      // ── Adjustable fields (defaults at generation) ──
      manualBonus:  0,
      deductions:   0,
      kasbon:       0,

      // ── Calculated total ──
      totalPay,

      // ── Audit trail arrays ──
      bonusBreakdown,         // per-day: { date, cupsSold, bonus }
      weeklyBonusBreakdown,   // per-week: { weekNumber, qualified, bonus }

      // ── Status & audit ──
      status:       'draft',
      generatedBy:  new mongoose.Types.ObjectId(user.userId),
      generatedAt:  new Date(),
      approvedBy:   null,
      approvedAt:   null,
    })
  }

  // ── Step 10: Batch insert ─────────────────────────────────────
  // ordered: false — one failure does not abort the rest
  let generated = 0

  if (payrollDocs.length > 0) {
    try {
      const result = await Payroll.insertMany(payrollDocs, { ordered: false })
      generated = result.length
    } catch (err) {
      if (err.code === 11000 || err.name === 'BulkWriteError') {
        generated = err.result?.nInserted ?? 0
        const writeErrors = err.writeErrors ?? []
        for (const we of writeErrors) {
          const failedDoc = payrollDocs[we.index]
          if (failedDoc) {
            skippedItems.push({
              employeeId: failedDoc.employeeId.toString(),
              reason:     'Duplicate payroll record (concurrent generation)',
            })
          }
        }
      } else {
        throw err
      }
    }
  }

  return {
    generated,
    skipped:      skippedItems.length,
    skippedItems,
  }
}

// ── getPayrolls ───────────────────────────────────────────────
// UNCHANGED from v1.0

export const getPayrolls = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  if (queryParams.outletId && user.role !== ROLES.MANAGER) {
    query.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.employeeId) {
    query.employeeId = new mongoose.Types.ObjectId(queryParams.employeeId)
  }

  if (queryParams.status) {
    query.status = queryParams.status
  }

  if (queryParams.month) {
    query['period.month'] = Number(queryParams.month)
  }

  if (queryParams.year) {
    query['period.year'] = Number(queryParams.year)
  }

  const [payrolls, total] = await Promise.all([
    Payroll.find(query)
      .sort({ 'period.year': -1, 'period.month': -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payroll.countDocuments(query),
  ])

  return {
    payrolls,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getPayrollById ────────────────────────────────────────────
// UNCHANGED from v1.0

export const getPayrollById = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query).lean()

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  return payroll
}

// ── approvePayroll ────────────────────────────────────────────
// UNCHANGED from v1.0

export const approvePayroll = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status !== 'draft') {
    throw new ApiError(400, `Only draft payrolls can be approved. Current status: '${payroll.status}'`)
  }

  payroll.status     = 'approved'
  payroll.approvedBy = new mongoose.Types.ObjectId(user.userId)
  payroll.approvedAt = new Date()

  await payroll.save()
  return payroll.toObject()
}

// ── rejectPayroll ─────────────────────────────────────────────
// UNCHANGED from v1.0

export const rejectPayroll = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status === 'paid') {
    throw new ApiError(400, 'Paid payrolls cannot be reverted')
  }

  if (payroll.status !== 'approved') {
    throw new ApiError(400, `Only approved payrolls can be rejected. Current status: '${payroll.status}'`)
  }

  payroll.status     = 'draft'
  payroll.approvedBy = null
  payroll.approvedAt = null

  await payroll.save()
  return payroll.toObject()
}

// ── adjustPayroll ─────────────────────────────────────────────
// Phase 4 changes:
//   1. kasbon wired (was in validation since Phase 1 but not in service)
//   2. calculateTotalPay() uses new object-based formula with ?? 0 fallbacks
//      so pre-Phase-4 records with null new fields are handled safely

export const adjustPayroll = async ({ tenantId, user, payrollId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status === 'paid') {
    throw new ApiError(400, 'Paid payrolls cannot be adjusted')
  }

  // Apply adjustments
  if (data.manualBonus !== undefined) payroll.manualBonus = data.manualBonus
  if (data.deductions  !== undefined) payroll.deductions  = data.deductions
  if (data.kasbon      !== undefined) payroll.kasbon      = data.kasbon  // Phase 4: wired

  // Recalculate totalPay using updated formula.
  // ?? 0 on all fields handles pre-Phase-4 records where new fields are null.
  payroll.totalPay = calculateTotalPay(payroll)

  await payroll.save()
  return payroll.toObject()
}

// ── markPayrollPaid ───────────────────────────────────────────
// UNCHANGED from v1.0

export const markPayrollPaid = async ({ tenantId, user, payrollId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(payrollId)

  const payroll = await Payroll.findOne(query)

  if (!payroll) {
    throw new ApiError(404, 'Payroll record not found')
  }

  if (payroll.status !== 'approved') {
    throw new ApiError(400, `Only approved payrolls can be marked paid. Current status: '${payroll.status}'`)
  }

  payroll.status = 'paid'
  await payroll.save()

  return payroll.toObject()
}