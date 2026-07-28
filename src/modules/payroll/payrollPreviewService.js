// ============================================================
// modules/payroll/payrollPreviewService.js
// Step 2 — Payroll Preview.
//
// READ-ONLY. This file must NEVER:
//   - write to the Payroll collection
//   - create a Notification
//   - modify Attendance, Sale, or CupRecord
//
// It gathers the exact same data generatePayroll() gathers
// (Outlet config, Employees, Attendance, Sale aggregate) and
// runs it through the SAME exported calculator functions from
// payrollCalculator.js / payrollDateUtils.js used by
// payroll.service.js — there is only one source of truth for
// payroll math. Preview must never re-implement or approximate
// a calculation.
//
// Preview does NOT apply the lock policy (create/recalc/skip)
// used by generatePayroll() — it has no concept of "existing
// payroll" beyond a read-only status flag per employee, since
// it never touches the Payroll collection for writes.
// ============================================================

import mongoose   from 'mongoose'
import Payroll    from '../../models/Payroll.model.js'
import { ROLES }  from '../../constants/permissions.js'

import { getPeriodDateRange, getPeriodDays } from './payrollDateUtils.js'
import {
  calculateSalaryEarned,
  calculateDailyTierBonus,
  calculateWeeklyAttendanceBonus,
  calculateTotalPay,
} from './payrollCalculator.js'
import {
  loadOutletConfig,
  loadActiveEmployees,
  loadEmployeeAttendance,
  loadEmployeeSales,
} from './payrollDataGatherer.js'

// ── previewPayroll ─────────────────────────────────────────────

/**
 * Computes what generatePayroll() would produce right now, for
 * every active employee in the outlet, WITHOUT writing anything.
 * Safe to call repeatedly (e.g. every time the owner opens the
 * payroll screen, or changes workingDays to see the effect live).
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - { outletId, month, year, workingDays }
 */
export const previewPayroll = async ({ tenantId, user, data }) => {
  const { outletId, month, year, workingDays } = data
  const numMonth       = Number(month)
  const numYear        = Number(year)
  const numWorkingDays = Number(workingDays)

  const tenantOid = user.role !== ROLES.SUPER_ADMIN
    ? new mongoose.Types.ObjectId(tenantId)
    : null
  const outletOid = new mongoose.Types.ObjectId(outletId)

  const { start, end } = getPeriodDateRange(numMonth, numYear)

  // ── Outlet config (same defaults as generatePayroll) ────────

  const { payrollType, commissionPercentage, mealAllowancePerDay, weeklyBonusAmount, bonusRules } =
    await loadOutletConfig(tenantOid, outletOid)

  const periodDays = getPeriodDays(numMonth, numYear)

  // ── Employees ────────────────────────────────────────────────

  const employees = await loadActiveEmployees(tenantOid, outletOid)

  if (employees.length === 0) {
    return {
      outletId:   outletOid.toString(),
      period:     { month: numMonth, year: numYear },
      workingDays: numWorkingDays,
      employees:  [],
      summary:    { totalEmployees: 0, totalPayrollCost: 0 },
    }
  }

  // ── Existing Payroll status per employee (read-only, informational) ──
  // Lets the owner see which employees are already locked BEFORE they
  // commit to Generate. This is a status flag only — Preview never
  // applies the create/recalc/skip decision itself.
  const existingQuery = {
    'period.month': numMonth,
    'period.year':  numYear,
    employeeId: { $in: employees.map((e) => e._id) },
  }
  if (tenantOid) existingQuery.tenantId = tenantOid

  const existingPayrolls = await Payroll.find(existingQuery)
    .select('employeeId status')
    .lean()

  const existingStatusMap = new Map(
    existingPayrolls.map((p) => [p.employeeId.toString(), p.status])
  )

  // ── Per-employee preview (read-only) ────────────────────────

  const employeePreviews = []
  let totalPayrollCost = 0

  for (const employee of employees) {
    const employeeOid = employee._id

    // ── Attendance ─────────────────────────────────────────────
    const { presentDays, absentDays, attendanceMap } =
      await loadEmployeeAttendance(tenantOid, employeeOid, start, end)

    // E14: effectivePresentDays used for salary proration ONLY.
    const effectivePresentDays = Math.min(presentDays, numWorkingDays)

    // ── Per-day sales aggregate ────────────────────────────────
    const { salesMap, totalCupsSold, totalRevenue } =
      await loadEmployeeSales(tenantOid, employeeOid, start, end)

    // ── Branch on payrollType ──────────────────────────────────
    let salaryEarned = 0
    let commission   = 0

    if (payrollType === 'commission') {
      commission   = Math.floor(totalRevenue * (commissionPercentage / 100))
      salaryEarned = commission
    } else {
      salaryEarned = calculateSalaryEarned(
        employee.salaryType,
        employee.baseSalary,
        effectivePresentDays,
        numWorkingDays
      )
    }

    // ── Meal allowance (raw presentDays, both types) ───────────
    const mealAllowanceTotal = Math.floor(mealAllowancePerDay * presentDays)

    // ── Daily tier bonus ────────────────────────────────────────
    const { totalBonus: dailyTierBonus, bonusBreakdown } =
      calculateDailyTierBonus(salesMap, bonusRules, periodDays)

    // ── Weekly attendance bonus ──────────────────────────────────
    const { totalBonus: weeklyAttendanceBonus, weeklyBonusBreakdown } =
      calculateWeeklyAttendanceBonus(attendanceMap, numMonth, numYear, weeklyBonusAmount)

    const totalPay = calculateTotalPay({
      salaryEarned,
      cupsBonus:             0,
      mealAllowanceTotal,
      dailyTierBonus,
      weeklyAttendanceBonus,
      manualBonus:           0,
      deductions:            0,
      kasbon:                0,
    })

    totalPayrollCost += totalPay

    employeePreviews.push({
      employeeId:            employeeOid.toString(),
      employeeName:          employee.name,
      salaryType:            employee.salaryType,
      baseSalary:            employee.baseSalary,
      payrollType,

      presentDays,
      absentDays,

      totalCupsSold,
      totalRevenue,
      commissionPercentage,
      commission,

      salaryEarned,
      mealAllowanceTotal,
      dailyTierBonus,
      weeklyAttendanceBonus,
      totalPay,

      bonusBreakdown,
      weeklyBonusBreakdown,

      // Informational only — Preview does not act on this.
      alreadyLocked: ['approved', 'paid'].includes(
        existingStatusMap.get(employeeOid.toString())
      ),
    })
  }

  return {
    outletId:    outletOid.toString(),
    period:      { month: numMonth, year: numYear },
    workingDays: numWorkingDays,
    employees:   employeePreviews,
    summary: {
      totalEmployees:   employeePreviews.length,
      totalPayrollCost,
    },
  }
}