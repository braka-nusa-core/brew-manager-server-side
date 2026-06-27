// ============================================================
// modules/riderPortal/riderPortal.service.js
// Phase 6A — Public Rider Portal.
//
// CRITICAL: This module is the ONLY code path that may be
// reached without authentication. It must never:
//   - import or call anything from payroll.service.js
//     (every export there requires an authenticated `user` object
//     this public endpoint does not have — confirmed by reading
//     payroll.service.js in full before this file was written)
//   - recalculate salary, bonus, or commission
//   - read Sale, Attendance, or CupRecord directly
//   - leak whether a 404 is due to "token not found" vs.
//     "employee deactivated" — both must look identical
//
// Payroll remains the single source of truth (Phase 4, stable,
// verified — untouched by this phase). This module performs its
// own direct Payroll.findOne() query, sorted to the latest period,
// and maps the stored fields to the public DTO shape. Nothing is
// computed here beyond field renaming/defaulting.
// ============================================================

import mongoose  from 'mongoose'
import Employee  from '../../models/Employee.model.js'
import Outlet    from '../../models/Outlet.model.js'
import Payroll   from '../../models/Payroll.model.js'
import ApiError  from '../../utils/ApiError.js'

// ── getRiderPortalData ────────────────────────────────────────

/**
 * Public lookup by portal token. No tenant/auth context — the
 * token itself IS the access credential, scoped to exactly one
 * Employee document via the unique index on Employee.portalToken.
 *
 * Returns a single generic 404 for ALL of:
 *   - token does not exist
 *   - employee.isActive === false
 * These cases are intentionally indistinguishable in the response
 * to prevent an attacker from using error differences to enumerate
 * which guessed tokens belong to real-but-deactivated employees.
 *
 * If no Payroll document exists yet for the current month, returns
 * 200 with all currentMonth fields zeroed — this is the expected,
 * normal state early in a month before generatePayroll() has run,
 * not an error condition.
 *
 * @param {string} token - the portal token from the URL param
 * @returns {Promise<Object>} { employee, currentMonth }
 */
export const getRiderPortalData = async (token) => {
  // portalToken has `select: false` on the schema — must explicitly
  // select it (with the leading '+') to query against it at all.
  const employee = await Employee.findOne({ portalToken: token })
    .select('+portalToken name isActive outletId tenantId')
    .lean()

  // Single generic 404 for "not found" AND "inactive" — see header note.
  if (!employee || !employee.isActive) {
    throw new ApiError(404, 'Rider portal not found')
  }

  const outlet = await Outlet.findById(employee.outletId).select('name').lean()

  const now   = new Date()
  const month = now.getUTCMonth() + 1
  const year  = now.getUTCFullYear()

  // Latest payroll for THIS specific period. If none exists yet
  // (admin hasn't run generatePayroll() this month), payroll is
  // null and every currentMonth field below defaults to 0 — never
  // an error, per approved architecture decision.
  const payroll = await Payroll.findOne({
    employeeId:     employee._id,
    'period.month': month,
    'period.year':  year,
  }).lean()

  return {
    employee: {
      id:     employee._id,
      name:   employee.name,
      outlet: outlet?.name ?? null,
    },
    currentMonth: {
      commission:      payroll?.commission             ?? 0,
      cupBonus:         payroll?.dailyTierBonus          ?? 0,
      attendanceBonus:  payroll?.weeklyAttendanceBonus   ?? 0,
      totalSalary:      payroll?.totalPay                ?? 0,
    },
  }
}