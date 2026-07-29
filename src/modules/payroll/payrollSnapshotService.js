// ============================================================
// modules/payroll/payrollSnapshotService.js
// Step 3 — Payroll Snapshot.
//
// This is the ONLY module allowed to write Payroll documents
// (insertMany / bulkWrite). Body moved verbatim from
// payroll.service.js's generatePayroll() — no behavior change,
// no query change, no calculation change. payroll.service.js
// now re-exports generatePayroll from here so the public API
// (POST /payroll/generate) is untouched.
//
// Shares payrollCalculator.js / payrollDateUtils.js with
// payrollPreviewService.js — one source of truth for payroll
// math, so Preview and Snapshot numbers can never drift apart.
// ============================================================

import mongoose   from 'mongoose'
import Payroll    from '../../models/Payroll.model.js'
import { ROLES }  from '../../constants/permissions.js'
import { notifyRiderBonusAchieved, notifyPayrollGenerated } from '../notification/notification.service.js'
// Notification Center addition. Both functions are internally
// try/catch-wrapped and never throw — they cannot affect any
// calculation, duplicate-guard, or insertMany logic below.

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

  const { payrollType, commissionPercentage, mealAllowancePerDay, weeklyBonusAmount, bonusRules, outlet } =
    await loadOutletConfig(tenantOid, outletOid)

  // Pre-compute period calendar days for tier bonus loop
  const periodDays = getPeriodDays(numMonth, numYear)

  // ── Fetch employees ───────────────────────────────────────────

  const employees = await loadActiveEmployees(tenantOid, outletOid)

  if (employees.length === 0) {
    return { generated: 0, updated: 0, skipped: 0, skippedItems: [] }
  }

  const skippedItems = []
  const payrollDocs  = []   // new documents → insertMany at the end
  const updateOps    = []   // existing draft documents → recalculated in place
  let updated = 0

  // ── Per-employee loop ─────────────────────────────────────────

  for (const employee of employees) {
    const employeeOid = employee._id

    // ── P0.3.3: Generate → create / update / locked ───────────
    // - Not found            → create (unchanged from before)
    // - Found, status draft  → recalculate using current Attendance
    //                          + Sales, update the existing document
    // - Found, approved/paid → locked; do NOT touch, report message
    const existingQuery = {
      employeeId:     employeeOid,
      'period.month': numMonth,
      'period.year':  numYear,
    }
    if (tenantOid) existingQuery.tenantId = tenantOid

    const existing = await Payroll.findOne(existingQuery).lean()
    console.log("Employee :", employee.name)
    console.log("existing :", existing?._id)
    console.log("existing outlet :", existing?.outletId)
    console.log("existing status :", existing?.status)
    console.log("branch :", existing ? "UPDATE" : "CREATE")

    if (existing && existing.status !== 'draft') {
      skippedItems.push({
        employeeId:   employeeOid.toString(),
        employeeName: employee.name,
        reason:       'Payroll has already been locked.',
      })
      continue
    }

    // ── Step 1–2: Attendance ──────────────────────────────────
    const { presentDays, absentDays, attendanceMap } =
      await loadEmployeeAttendance(tenantOid, employeeOid, start, end)

    // ── Step 3: E14 cap ───────────────────────────────────────
    // effectivePresentDays used for salary proration ONLY.
    // Raw presentDays used for mealAllowanceTotal (intentional — see E14 decision).
    const effectivePresentDays = Math.min(presentDays, numWorkingDays)

    // ── Step 4: Per-day sales aggregate ──────────────────────
    // Phase 4: group by date to enable per-day tier bonus evaluation.
    const { salesMap, totalCupsSold, totalRevenue } =
      await loadEmployeeSales(tenantOid, employeeOid, start, end)

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
    const { totalBonus: weeklyAttendanceBonus, weeklyBonusBreakdown } =
      calculateWeeklyAttendanceBonus(attendanceMap, numMonth, numYear, weeklyBonusAmount)


    // ── Step 9: Build recalculated fields ──────────────────────
    // P0.3.3: when updating an existing draft, preserve any manual
    // adjustments (manualBonus/deductions/kasbon) the owner already
    // made — only the recalculated (attendance/sales-derived) fields
    // are refreshed. calculateTotalPay() is reused unchanged either way.
    const manualBonus = existing ? (existing.manualBonus ?? 0) : 0
    const deductions  = existing ? (existing.deductions  ?? 0) : 0
    const kasbon      = existing ? (existing.kasbon      ?? 0) : 0

    const payrollFields = {
      salaryEarned,
      cupsBonus:             0,            // legacy field — explicitly 0 on Phase 4 records
      mealAllowanceTotal,
      dailyTierBonus,
      weeklyAttendanceBonus,
      manualBonus,
      deductions,
      kasbon,
    }

    const totalPay = calculateTotalPay(payrollFields)


    const recalculatedFields = {
      // ── Snapshot: employee state at (re)generation time ──
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
      // P0.3.2.1: snapshots of the inputs behind `commission`. Immutable
      // once locked (approved/paid); refreshed on every draft recalculation
      // per P0.3.3, since the payroll is still "running" until locked.
      totalRevenue,
      commissionPercentage,
      salaryEarned,
      mealAllowanceTotal,
      dailyTierBonus,
      weeklyAttendanceBonus,

      // ── Calculated total ──
      totalPay,

      // ── Audit trail arrays ──
      bonusBreakdown,         // per-day: { date, cupsSold, bonus }
      weeklyBonusBreakdown,   // per-week: { weekNumber, qualified, bonus }
    }

    if (existing) {
      // ── Update path: recalculate existing draft in place ────
      updateOps.push({
        updateOne: {
          filter: { _id: existing._id },
          update: { $set: recalculatedFields },
        },
      })
      updated++
    } else {
      // ── Create path: unchanged from before ───────────────────

      payrollDocs.push({
        tenantId:     tenantOid ?? undefined,
        outletId:     outletOid,
        employeeId:   employeeOid,
        period:       { month: numMonth, year: numYear },

        ...recalculatedFields,
        cupsBonus:             0,            // legacy field — 0 on Phase 4 records

        // ── Adjustable fields (defaults at generation) ──
        manualBonus:  0,
        deductions:   0,
        kasbon:       0,

        // ── Status & audit ──
        status:       'draft',
        generatedBy:  new mongoose.Types.ObjectId(user.userId),
        generatedAt:  new Date(),
        approvedBy:   null,
        approvedAt:   null,
      })

    }

    // ── Notification Center addition ──────────────────────────
    // Fires strictly after payrollDocs.push() above — cannot affect
    // the document just built. Internally try/catch-wrapped in
    // notification.service.js; never throws, so it can never break
    // this loop or the batch insert that follows it. Uses
    // employee.tenantId (not tenantOid) so this is correct even
    // when a super_admin generates payroll (tenantOid is null then).
    if (employee.isRider && (dailyTierBonus > 0 || weeklyAttendanceBonus > 0)) {
      await notifyRiderBonusAchieved({
        tenantId:    employee.tenantId,
        outletId:    outletOid,
        employee,
        month:       numMonth,
        year:        numYear,
        bonusAmount: dailyTierBonus + weeklyAttendanceBonus,
      })
    }
  }

  // ── Step 10: Batch insert + batch update ───────────────────────
  // ordered: false — one failure does not abort the rest
  let generated = 0

  try {
    const collections = await mongoose.connection.db.listCollections().toArray()
  } catch (diagErr) {
  }

  if (payrollDocs.length > 0) {
    try {
      const result = await Payroll.insertMany(payrollDocs, { ordered: false })

      generated = result.length

      // ── DIAGNOSTIC ONLY — re-query Mongo directly to check whether
      // documents actually landed in the collection regardless of
      // what insertMany's return value claims ──────────────────
      const inserted = await Payroll.find({
        outletId:       outletOid,
        'period.month': numMonth,
        'period.year':  numYear,
      }).lean()
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

  // P0.3.3: recalculate existing draft payrolls in place. Each op is
  // filtered on _id, so this can never touch an approved/paid record —
  // those were already excluded earlier in the loop.
  if (updateOps.length > 0) {
    await Payroll.bulkWrite(updateOps, { ordered: false })
  }

  // ── Notification Center addition ──────────────────────────────
  // Fires after the batch insert above is fully resolved (success
  // or partial failure) — uses the already-computed `generated`
  // and `skippedItems` values, does not recompute or alter them.
  // Internally try/catch-wrapped; never throws.
  await notifyPayrollGenerated({
    tenantId:          outlet.tenantId,
    outletId:          outletOid,
    outletName:        outlet.name,
    generatedByUserId: user.userId,
    month:             numMonth,
    year:              numYear,
    generated,
    skipped:           skippedItems.length,
  })

  return {
    generated,
    updated,
    skipped:      skippedItems.length,
    skippedItems,
  }
}