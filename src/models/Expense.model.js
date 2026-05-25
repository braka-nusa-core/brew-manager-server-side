// ============================================================
// models/Expense.model.js
// Represents an operational expense for an outlet on a date.
//
// Design decisions:
//   - Expenses are outlet-level, not employee-level.
//     No employeeId field — expenses are operational overhead.
//   - category uses a controlled enum for grouping and analytics.
//   - description is required — free-text context for each entry.
//   - amount is non-negative. Zero is valid (a logged zero expense).
//   - No soft delete — expenses can be hard deleted and corrected,
//     same rationale as attendance records.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const EXPENSE_CATEGORIES = ['ingredient', 'utility', 'maintenance', 'other']

const expenseSchema = new Schema(
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

    // ── Date ──────────────────────────────────────────────────

    date: {
      type:     Date,
      required: [true, 'Expense date is required'],
    },

    // ── Category ──────────────────────────────────────────────

    category: {
      type:     String,
      enum:     {
        values:  EXPENSE_CATEGORIES,
        message: `Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`,
      },
      required: [true, 'Category is required'],
    },

    // ── Details ───────────────────────────────────────────────

    description: {
      type:      String,
      required:  [true, 'Description is required'],
      trim:      true,
      minlength: [2,   'Description must be at least 2 characters'],
      maxlength: [255, 'Description must not exceed 255 characters'],
    },

    amount: {
      type:     Number,
      required: [true, 'Amount is required'],
      min:      [0, 'Amount cannot be negative'],
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

// Primary list + reporting query
expenseSchema.index({ tenantId: 1, outletId: 1, date: -1 })

// Category breakdown within outlet
expenseSchema.index({ tenantId: 1, outletId: 1, category: 1, date: -1 })

// Tenant-wide date range analytics
expenseSchema.index({ tenantId: 1, date: -1 })

const Expense = model('Expense', expenseSchema)

export default Expense
