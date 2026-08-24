// ============================================================
// modules/payroll/payrollCalculator.js
// Pure payroll calculation functions extracted verbatim from
// payroll.service.js (Step 1 of Payroll redesign — no behavior
// change).
//
// RULE: this file must NEVER import mongoose or any model.
// Every function here takes plain data in and returns plain
// data out. This is what makes the calculations unit-testable
// without a database, and what Preview + Snapshot both share
// so their numbers can never drift apart.
// ============================================================

import { getLastDayOfMonth } from './payrollDateUtils.js'

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
export const calculateSalaryEarned = (salaryType, baseSalary, effectivePresentDays, workingDays) => {
  if (salaryType === 'monthly') {
    return Math.floor((baseSalary / workingDays) * effectivePresentDays)
  }
  // daily
  return Math.floor(baseSalary * effectivePresentDays)
}

/**
 * Builds a Map<dateString, { cups, revenue }> from the per-day
 * Sales aggregate result.
 *
 * @param {Array} salesAggResult - result from per-day $group aggregate
 * @returns {{ salesMap: Map, totalCups: number, totalRevenue: number }}
 */
export const buildDailySalesMap = (salesAggResult) => {
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
export const buildAttendanceMap = (attendanceRecords) => {
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
export const calculateDailyTierBonus = (salesMap, bonusRules, periodDays) => {
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
export const calculateWeeklyAttendanceBonus = (attendanceMap, month, year, bonusPerWeek) => {
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
 * @param {Object} p - payroll document (or plain object with all fields)
 * @returns {number}
 */
export const calculateTotalPay = (p) =>
  Math.max(
    0,
    Math.floor(
      (p.salaryEarned          ?? 0)
      + (p.cupsBonus             ?? 0)   // legacy field — 0 on new records, preserved for old
      + (p.mealAllowanceTotal    ?? 0)
      + (p.riderAllowanceTotal   ?? 0)   // Phase 2.6 — wallet-derived, monthly riders only
      + (p.dailyTierBonus        ?? 0)
      + (p.weeklyAttendanceBonus ?? 0)
      + (p.manualBonus           ?? 0)
      - (p.deductions            ?? 0)
      - (p.kasbon                ?? 0)
      - (p.riderCashAdvanceDeduction ?? 0)   // Phase 3.5 — riders only, auto-computed
    )
  )