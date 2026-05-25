// ============================================================
// models/Sale.model.js
// Represents one employee's sales contribution for a date/shift.
//
// Design decisions:
//   - One record = one employee + one date contribution.
//     Multiple employees can have sales on the same date.
//     There is NO unique constraint on (tenantId, employeeId, date)
//     because a future phase may support multiple shifts per day.
//     If single-record-per-day is required, a unique index can
//     be added without schema changes.
//   - outletId is stored directly — not derived at query time —
//     to allow efficient outlet-scoped aggregations.
//   - totalCups and totalRevenue are non-negative numbers.
//     Both are required — zero is valid (a recorded zero day).
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const saleSchema = new Schema(
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

    // ── Employee Reference ────────────────────────────────────

    employeeId: {
      type:     Schema.Types.ObjectId,
      ref:      'Employee',
      required: [true, 'Employee ID is required'],
    },

    // ── Date ──────────────────────────────────────────────────
    // Normalized to midnight UTC in the service layer.

    date: {
      type:     Date,
      required: [true, 'Sale date is required'],
    },

    // ── Metrics ───────────────────────────────────────────────

    totalCups: {
      type:     Number,
      required: [true, 'Total cups is required'],
      min:      [0, 'Total cups cannot be negative'],
    },

    totalRevenue: {
      type:     Number,
      required: [true, 'Total revenue is required'],
      min:      [0, 'Total revenue cannot be negative'],
    },

    // ── Optional ──────────────────────────────────────────────

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },

    // ── Audit ─────────────────────────────────────────────────

    recordedBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Recorded by (userId) is required'],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// Primary list + aggregation query pattern
saleSchema.index({ tenantId: 1, outletId: 1, date: -1 })

// Per-employee summary queries
saleSchema.index({ tenantId: 1, employeeId: 1, date: -1 })

// Outlet-wide date range queries
saleSchema.index({ tenantId: 1, date: -1 })

const Sale = model('Sale', saleSchema)

export default Sale
