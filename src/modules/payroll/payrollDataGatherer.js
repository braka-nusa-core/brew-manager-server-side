// ============================================================
// modules/payroll/payrollDataGatherer.js
// Step 4 — Shared Payroll Data Gatherer.
//
// Responsible ONLY for loading payroll data. No calculations,
// no Payroll writes, no notifications. Preview and Snapshot
// both call this — same queries, same filters, same shape —
// so there is exactly one place that decides how Outlet config,
// Employees, Attendance, and Sales are loaded for payroll.
//
// Extracted verbatim from the duplicated blocks in
// payrollPreviewService.js and payrollSnapshotService.js —
// no query changed, no filter changed, no behavior changed.
// ============================================================

import mongoose   from 'mongoose'
import Employee   from '../../models/Employee.model.js'
import Attendance from '../../models/Attendance.model.js'
import Sale       from '../../models/Sale.model.js'
import Outlet     from '../../models/Outlet.model.js'
import ApiError   from '../../utils/ApiError.js'

import { buildDailySalesMap, buildAttendanceMap } from './payrollCalculator.js'

/**
 * Loads Outlet config with safe defaults (same defaults used by
 * generatePayroll() since Phase 4).
 *
 * @param {import('mongoose').Types.ObjectId|null} tenantOid
 * @param {import('mongoose').Types.ObjectId} outletOid
 * @returns {Promise<{outlet: Object, payrollType: string, commissionPercentage: number,
 *   mealAllowancePerDay: number, weeklyBonusAmount: number, bonusRules: Array}>}
 */
export const loadOutletConfig = async (tenantOid, outletOid) => {
  const outlet = await Outlet.findOne({
    _id:       outletOid,
    isActive:  true,
    deletedAt: null,
    ...(tenantOid ? { tenantId: tenantOid } : {}),
  }).lean()

  if (!outlet) {
    throw new ApiError(404, 'Outlet not found or is inactive')
  }

  const payrollType          = outlet.payrollType          ?? 'fixed'
  const commissionPercentage = outlet.commissionPercentage ?? 0
  const mealAllowancePerDay  = outlet.mealAllowancePerDay  ?? 0
  const weeklyBonusAmount    = outlet.weeklyAttendanceBonus ?? 0
  // Sort bonus rules ascending by minCups — never trust client ordering
  const bonusRules           = [...(outlet.bonusRules ?? [])].sort((a, b) => a.minCups - b.minCups)

  return { outlet, payrollType, commissionPercentage, mealAllowancePerDay, weeklyBonusAmount, bonusRules }
}

/**
 * Loads active employees scoped to tenant/outlet.
 *
 * @param {import('mongoose').Types.ObjectId|null} tenantOid
 * @param {import('mongoose').Types.ObjectId} outletOid
 * @returns {Promise<Array>}
 */
export const loadActiveEmployees = async (tenantOid, outletOid) => {
  const employeeQuery = { outletId: outletOid, isActive: true }
  if (tenantOid) employeeQuery.tenantId = tenantOid

  return Employee.find(employeeQuery).lean()
}

/**
 * Loads attendance records for one employee/period and reduces them
 * into presentDays/absentDays/attendanceMap.
 *
 * @param {import('mongoose').Types.ObjectId|null} tenantOid
 * @param {import('mongoose').Types.ObjectId} employeeOid
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<{attendanceRecords: Array, presentDays: number,
 *   absentDays: number, attendanceMap: Map}>}
 */
export const loadEmployeeAttendance = async (tenantOid, employeeOid, start, end) => {
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

  const attendanceMap = buildAttendanceMap(attendanceRecords)

  return { attendanceRecords, presentDays, absentDays, attendanceMap }
}

/**
 * Loads the per-day sales aggregate for one employee/period and
 * reduces it into a salesMap + totals.
 *
 * @param {import('mongoose').Types.ObjectId|null} tenantOid
 * @param {import('mongoose').Types.ObjectId} employeeOid
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<{salesMap: Map, totalCupsSold: number, totalRevenue: number}>}
 */
export const loadEmployeeSales = async (tenantOid, employeeOid, start, end) => {
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

  return { salesMap, totalCupsSold, totalRevenue }
}