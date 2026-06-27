// ============================================================
// config/payroll.config.js
// Configurable payroll constants.
//
// Design decision:
//   Bonus rates are NOT hardcoded in the service layer.
//   They live here so they can be adjusted per-deployment
//   or moved to a DB config collection in a future phase
//   without touching business logic.
//// ============================================================
// config/payroll.config.js
// Configurable payroll constants.
//
// ⚠️ PHASE 4 UPDATE — BONUS_PER_CUP IS DEPRECATED
//
//   As of Phase 4 (v2.0 payroll engine), the daily cup tier bonus
//   is driven entirely by Outlet.bonusRules[] — a per-outlet,
//   configurable, additive tier system (e.g. 50 cups = +10,000,
//   80 cups = +15,000 additional).
//
//   BONUS_PER_CUP below is NO LONGER IMPORTED OR USED by
//   payroll.service.js. It is kept here only for historical
//   reference and in case any external script or report still
//   references it. Do NOT reintroduce it into the payroll
//   calculation engine — doing so would silently produce
//   incorrect bonus figures alongside the new tier system.
//
//   See: Outlet.model.js → bonusRules field
//        payroll.service.js → calculateDailyTierBonus()
//
// Design decision (pre-Phase 4, preserved for context):
//   Bonus rates were not hardcoded in the service layer.
//   They lived here so they could be adjusted per-deployment
//   without touching business logic. Phase 4 moved this
//   responsibility to the Outlet model for per-outlet granularity.
// ============================================================

export const PAYROLL_CONFIG = {
  /**
   * @deprecated Since Phase 4. Replaced by Outlet.bonusRules[].
   * Bonus amount per cup sold by an employee in a period.
   * Unit: same currency as baseSalary (e.g. IDR).
   *
   * DO NOT USE in payroll.service.js. Retained for historical
   * reference only.
   */
  BONUS_PER_CUP: 500,

  /**
   * Default number of working days in a month.
   * Used as fallback when workingDays is not explicitly provided
   * during payroll generation. Callers should always provide
   * the actual working days for the period.
   *
   * Still active in Phase 4 — unrelated to the bonus system.
   */
  DEFAULT_WORKING_DAYS: 26,
}
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
