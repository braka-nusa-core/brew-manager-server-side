// ============================================================
// config/payroll.config.js
// Configurable payroll constants.
//
// Design decision:
//   Bonus rates are NOT hardcoded in the service layer.
//   They live here so they can be adjusted per-deployment
//   or moved to a DB config collection in a future phase
//   without touching business logic.
//
//   In a production multi-tenant system, BONUS_PER_CUP
//   would eventually be a per-tenant or per-outlet config
//   stored in the database. For MVP, a single global rate
//   defined here is the correct starting point.
// ============================================================

export const PAYROLL_CONFIG = {
  /**
   * Bonus amount per cup sold by an employee in a period.
   * Unit: same currency as baseSalary (e.g. IDR).
   *
   * Example: if an employee sold 200 cups and BONUS_PER_CUP = 500,
   * cupsBonus = 200 × 500 = 100,000
   */
  BONUS_PER_CUP: 500,

  /**
   * Default number of working days in a month.
   * Used as fallback when workingDays is not explicitly provided
   * during payroll generation. Callers should always provide
   * the actual working days for the period.
   */
  DEFAULT_WORKING_DAYS: 26,
}
