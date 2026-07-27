// ============================================================
// models/Payroll.model.js
// v1.1 — Phase 1 extension: new payroll type + bonus fields.
//
// NEW FIELDS (all optional, default 0 — backward compatible):
//   payrollType:           'fixed'|'commission'   snapshot at generation
//   commission:            Number  — revenue × commissionPercentage
//   mealAllowanceTotal:    Number  — mealAllowancePerDay × presentDays
//   dailyTierBonus:        Number  — accumulated daily cup tier bonuses
//   weeklyAttendanceBonus: Number  — accumulated weekly attendance bonuses
//   kasbon:                Number  — cash advance deduction (manual entry)
//   bonusBreakdown:        Array   — per-day audit trail for tier bonus
//   weeklyBonusBreakdown:  Array   — per-week audit trail for attendance bonus
//
// NAMING NOTE:
//   mealAllowanceTotal (not mealAllowance) — avoids confusion with
//   Outlet.mealAllowancePerDay (the daily rate config).
//   mealAllowanceTotal is the calculated period total.
//
// SNAPSHOT NOTE:
//   For commission-type payroll, baseSalary is still copied from
//   Employee at generation time but is NOT used in calculation.
//   It is stored for reference only. salaryEarned = commission
//   for commission type.
//
// EXISTING FIELDS: completely unchanged. cupsBonus field is
//   preserved (used by old fixed payroll logic) but will not be
//   populated by the new engine — dailyTierBonus replaces it.
//   Both fields coexist for backward compatibility.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const PAYROLL_STATUSES = ['draft', 'approved', 'paid']

const payrollSchema = new Schema(
  {
    // ── Tenant & Outlet Scope ─────────────────────────────────

    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    outletId: {
      type:     Schema.Types.ObjectId,
      ref:      'Outlet',
      required: [true, 'Outlet ID is required'],
    },

    employeeId: {
      type:     Schema.Types.ObjectId,
      ref:      'Employee',
      required: [true, 'Employee ID is required'],
    },

    // ── Period ────────────────────────────────────────────────

    period: {
      month: {
        type:     Number,
        required: [true, 'Period month is required'],
        min:      [1, 'Month must be between 1 and 12'],
        max:      [12, 'Month must be between 1 and 12'],
      },
      year: {
        type:     Number,
        required: [true, 'Period year is required'],
        min:      [2000, 'Year must be 2000 or later'],
      },
    },

    // ── Snapshot: Employee State at Generation Time ───────────

    salaryType: {
      type:     String,
      enum:     ['monthly', 'daily'],
      required: [true, 'Salary type snapshot is required'],
    },

    baseSalary: {
      type:     Number,
      required: [true, 'Base salary snapshot is required'],
      min:      [0, 'Base salary cannot be negative'],
    },

    // ── Payroll Type Snapshot (Phase 1 addition) ──────────────
    // Copied from Outlet.payrollType at generation time.
    // Determines which calculation engine was used.
    // 'fixed' = base salary engine
    // 'commission' = revenue × commissionPercentage (no base salary)

    payrollType: {
      type:    String,
      enum:    {
        values:  ['fixed', 'commission'],
        message: 'payrollType must be "fixed" or "commission"',
      },
      default: 'fixed',
    },

    // ── Attendance Summary ────────────────────────────────────

    workingDays: {
      type:     Number,
      required: [true, 'Working days is required'],
      min:      [1, 'Working days must be at least 1'],
    },

    presentDays: {
      type:    Number,
      default: 0,
      min:     [0, 'Present days cannot be negative'],
    },

    absentDays: {
      type:    Number,
      default: 0,
      min:     [0, 'Absent days cannot be negative'],
    },

    // ── Sales Summary ─────────────────────────────────────────

    totalCupsSold: {
      type:    Number,
      default: 0,
      min:     [0, 'Total cups sold cannot be negative'],
    },

    // Legacy field — kept for backward compatibility with old
    // payroll records. New engine uses dailyTierBonus instead.
    cupsBonus: {
      type:    Number,
      default: 0,
      min:     [0, 'Cups bonus cannot be negative'],
    },

    // ── Commission (Phase 1 addition) ─────────────────────────
    // Populated for commission-type payrolls only.
    // commission = riderRevenue × (commissionPercentage / 100)
    // For fixed-type payrolls, this remains 0.

    commission: {
      type:    Number,
      default: 0,
      min:     [0, 'Commission cannot be negative'],
    },

    // ── Commission Snapshot (P0.3.2.1 addition) ───────────────
    // Snapshot of the raw inputs used to compute `commission` above.
    // Persisted at generation time from values already calculated in
    // generatePayroll() — never recalculated or re-queried afterwards.
    // Immutable: adjustPayroll() must never write to these fields.
    // For fixed-type payrolls these remain 0 (no revenue/rate applies).

    totalRevenue: {
      type:    Number,
      default: 0,
      min:     [0, 'Total revenue cannot be negative'],
    },

    commissionPercentage: {
      type:    Number,
      default: 0,
      min:     [0, 'Commission percentage cannot be negative'],
    },

    // ── Meal Allowance Total (Phase 1 addition) ───────────────
    // Calculated: Outlet.mealAllowancePerDay × presentDays
    // Applies to both fixed and commission payroll types.

    mealAllowanceTotal: {
      type:    Number,
      default: 0,
      min:     [0, 'Meal allowance cannot be negative'],
    },

    // ── Daily Tier Bonus (Phase 1 addition) ───────────────────
    // Sum of all qualifying daily cup tier bonuses across the period.
    // Calculated per-day (not monthly aggregate) from Outlet.bonusRules.
    // Applies to both fixed and commission payroll types.

    dailyTierBonus: {
      type:    Number,
      default: 0,
      min:     [0, 'Daily tier bonus cannot be negative'],
    },

    // ── Weekly Attendance Bonus (Phase 1 addition) ────────────
    // Sum of all qualifying weekly attendance bonuses.
    // Each qualifying week adds Outlet.weeklyAttendanceBonus.
    // Evaluated independently per week — no cascading penalties.

    weeklyAttendanceBonus: {
      type:    Number,
      default: 0,
      min:     [0, 'Weekly attendance bonus cannot be negative'],
    },

    // ── Kasbon (Phase 1 addition) ─────────────────────────────
    // Cash advance deduction — entered manually during adjust phase.
    // Same workflow as existing manualBonus and deductions fields.

    kasbon: {
      type:    Number,
      default: 0,
      min:     [0, 'Kasbon cannot be negative'],
    },

    // ── Manual Adjustments ────────────────────────────────────

    manualBonus: {
      type:    Number,
      default: 0,
      min:     [0, 'Manual bonus cannot be negative'],
    },

    deductions: {
      type:    Number,
      default: 0,
      min:     [0, 'Deductions cannot be negative'],
    },

    // ── Calculated Totals ─────────────────────────────────────

    salaryEarned: {
      type:    Number,
      default: 0,
    },

    totalPay: {
      type:    Number,
      default: 0,
    },

    // ── Bonus Audit Trail (Phase 1 addition) ──────────────────
    // Stored at generation time — never recalculated.
    // Used for dispute resolution and payslip detail.

    // Per-day breakdown of daily tier bonus.
    // Each entry: { date, cupsSold, bonus }
    bonusBreakdown: {
      type: [{
        date:     { type: Date,   required: true },
        cupsSold: { type: Number, required: true, min: 0 },
        bonus:    { type: Number, required: true, min: 0 },
        _id:      false,
      }],
      default: [],
    },

    // Per-week breakdown of weekly attendance bonus.
    // Each entry: { weekNumber, qualified, bonus }
    weeklyBonusBreakdown: {
      type: [{
        weekNumber: { type: Number,  required: true },
        qualified:  { type: Boolean, required: true },
        bonus:      { type: Number,  required: true, min: 0 },
        _id:        false,
      }],
      default: [],
    },

    // ── Status ────────────────────────────────────────────────

    status: {
      type:    String,
      enum:    {
        values:  PAYROLL_STATUSES,
        message: `Status must be one of: ${PAYROLL_STATUSES.join(', ')}`,
      },
      default: 'draft',
    },

    // ── Audit ─────────────────────────────────────────────────

    generatedBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Generated by (userId) is required'],
    },

    approvedBy: {
      type:    Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    generatedAt: {
      type:    Date,
      default: () => new Date(),
    },

    approvedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

payrollSchema.index(
  { tenantId: 1, employeeId: 1, 'period.month': 1, 'period.year': 1 },
  { unique: true }
)

payrollSchema.index({ tenantId: 1, outletId: 1, 'period.year': -1, 'period.month': -1 })
payrollSchema.index({ tenantId: 1, status: 1 })
payrollSchema.index({ tenantId: 1, payrollType: 1 })  // Phase 1: filter by type

const Payroll = model('Payroll', payrollSchema)

export default Payroll