// ============================================================
// modules/payroll/payrollDateUtils.js
// Pure date helpers extracted verbatim from payroll.service.js
// (Step 1 of Payroll redesign — no behavior change).
//
// No I/O, no Mongoose, no tenant/outlet logic — safe to import
// from calculators, gatherers, preview/snapshot services, and
// debug/test scripts alike.
// ============================================================

/**
 * Builds period start/end date range for a month/year.
 * Start: first millisecond of month (UTC)
 * End:   last millisecond of month (UTC)
 */
export const getPeriodDateRange = (month, year) => {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const end   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  return { start, end }
}

/**
 * Returns total days in a given month/year.
 * Used for Week 5 guard and period day iteration.
 *
 * @param {number} month - 1-12
 * @param {number} year
 * @returns {number} last day of month (28, 29, 30, or 31)
 */
export const getLastDayOfMonth = (month, year) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * Returns an array of all calendar day strings (YYYY-MM-DD) in the period.
 * Used for daily tier bonus loop.
 *
 * @param {number} month - 1-12
 * @param {number} year
 * @returns {string[]} e.g. ['2026-05-01', '2026-05-02', ...]
 */
export const getPeriodDays = (month, year) => {
  const lastDay = getLastDayOfMonth(month, year)
  const days = []
  for (let d = 1; d <= lastDay; d++) {
    const mm = String(month).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    days.push(`${year}-${mm}-${dd}`)
  }
  return days
}