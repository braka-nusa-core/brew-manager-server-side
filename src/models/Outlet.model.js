// ============================================================
// models/Outlet.model.js
// v1.1 — Phase 1 extension: payroll configuration fields added.
//
// NEW FIELDS (all optional, safe defaults — backward compatible):
//   payrollType:           'fixed' | 'commission'   default: 'fixed'
//   commissionPercentage:  Number 0-100              default: 0
//   mealAllowancePerDay:   Number >= 0               default: 0
//   weeklyAttendanceBonus: Number >= 0               default: 0
//   bonusRules:            [{ minCups, bonusAmount }] default: []
//
// IMPORTANT: commissionPerCup is NOT added — commission is
// revenue-based (commissionPercentage), not cup-based.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const outletSchema = new Schema(
  {
    // ── Tenant Scope ──────────────────────────────────────────

    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    // ── Identity ──────────────────────────────────────────────

    name: {
      type:      String,
      required:  [true, 'Outlet name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    code: {
      type:      String,
      required:  [true, 'Outlet code is required'],
      trim:      true,
      uppercase: true,
      minlength: [2,  'Code must be at least 2 characters'],
      maxlength: [10, 'Code must not exceed 10 characters'],
    },

    // ── Location & Contact ────────────────────────────────────

    address: {
      type:    String,
      trim:    true,
      default: null,
    },

    phone: {
      type:    String,
      trim:    true,
      default: null,
    },

    // ── Status ────────────────────────────────────────────────

    isActive: {
      type:    Boolean,
      default: true,
    },

    deletedAt: {
      type:    Date,
      default: null,
    },

    // ── Payroll Configuration (Phase 1 additions) ─────────────
    // All fields have safe defaults — existing outlets without
    // these fields behave exactly as before (fixed salary, no bonus).

    payrollType: {
      type:    String,
      enum:    {
        values:  ['fixed', 'commission'],
        message: 'payrollType must be either "fixed" or "commission"',
      },
      default: 'fixed',
    },

    // Revenue-based commission percentage (0–100).
    // Only used when payrollType = 'commission'.
    // Commission = riderRevenue × (commissionPercentage / 100)
    commissionPercentage: {
      type:    Number,
      default: 0,
      min:     [0,   'commissionPercentage cannot be negative'],
      max:     [100, 'commissionPercentage cannot exceed 100'],
    },

    // Meal allowance in IDR per present day.
    // Applies to BOTH fixed and commission payroll types.
    // mealAllowanceTotal = mealAllowancePerDay × presentDays
    mealAllowancePerDay: {
      type:    Number,
      default: 0,
      min:     [0, 'mealAllowancePerDay cannot be negative'],
    },

    // Weekly attendance bonus in IDR per perfect-attendance week.
    // A week qualifies only if all working days are 'present' or 'late'.
    // Applies to BOTH fixed and commission payroll types.
    weeklyAttendanceBonus: {
      type:    Number,
      default: 0,
      min:     [0, 'weeklyAttendanceBonus cannot be negative'],
    },

    // Configurable daily cup tier bonus rules.
    // Each tier: if cupsSoldToday >= minCups → add bonusAmount
    // Tiers are ADDITIVE — all qualifying tiers are summed per day.
    // Example: [{ minCups: 50, bonusAmount: 10000 }, { minCups: 80, bonusAmount: 15000 }]
    // Applies to BOTH fixed and commission payroll types.
    bonusRules: {
      type:    [{
        minCups:     { type: Number, required: true, min: [1, 'minCups must be at least 1'] },
        bonusAmount: { type: Number, required: true, min: [1, 'bonusAmount must be at least 1'] },
        _id:         false,  // suppress auto _id on subdocuments
      }],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

outletSchema.index({ tenantId: 1, isActive: 1 })
outletSchema.index({ tenantId: 1, code: 1 }, { unique: true })
outletSchema.index({ tenantId: 1, name: 1 })

const Outlet = model('Outlet', outletSchema)

export default Outlet