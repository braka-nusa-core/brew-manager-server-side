// ============================================================
// models/CashAdvance.model.js
// Phase 3.5 — Rider Cash Advance / Kasbon.
//
// ONE unified concept for ALL employees (rider, cashier, manager,
// barista, supervisor) — not separate RiderKasbon/CashierKasbon/
// ManagerKasbon models. The employee's role/type determines
// settlement behavior in the SERVICE layer (only riders get
// automatic Payroll deduction), not the schema.
//
// EXPLICITLY NOT a Wallet transaction. Does not touch
// EmployeeWalletLedger, does not affect wallet balance, does not use
// any WALLET_TRANSACTION_TYPES value.
//
// Multiple advances per employee are independently auditable rows —
// NOT a single mutable running total (unlike the legacy Payroll.kasbon
// field, which this model is intended to eventually replace as the
// source of truth for rider deductions).
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const CASH_ADVANCE_STATUSES = ['outstanding', 'settled']

const cashAdvanceSchema = new Schema(
  {
    // ── Tenant & Outlet Scope ────────────────────────────────

    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    // Snapshot of the employee's outlet AT RECORD TIME — same
    // convention as EmployeeWalletLedger.outletId. Reporting-only;
    // never used to scope settlement or outstanding totals.
    outletId: {
      type:     Schema.Types.ObjectId,
      ref:      'Outlet',
      required: [true, 'Outlet ID is required'],
    },

    // ── Employee ──────────────────────────────────────────────

    employeeId: {
      type:     Schema.Types.ObjectId,
      ref:      'Employee',
      required: [true, 'Employee ID is required'],
    },

    // ── Advance Details ───────────────────────────────────────

    amount: {
      type:     Number,
      required: [true, 'Amount is required'],
      min:      [1, 'Amount must be greater than 0'],
    },

    date: {
      type:     Date,
      required: [true, 'Date is required'],
    },

    // Mandatory purpose/notes — Owner must be able to see who took it,
    // when, how much, and why.
    notes: {
      type:      String,
      required:  [true, 'Notes / purpose is required'],
      trim:      true,
      minlength: [2, 'Notes must be at least 2 characters'],
      maxlength: [255, 'Notes must not exceed 255 characters'],
    },

    // ── Status & Settlement ───────────────────────────────────
    // Minimum status model only — no pending/approved/rejected/
    // cancelled. Settlement timing is driven entirely by Payroll's
    // EXISTING status semantics — an advance becomes 'settled' only
    // when the Payroll that claimed it actually reaches 'paid'.

    status: {
      type:    String,
      enum:    {
        values:  CASH_ADVANCE_STATUSES,
        message: `status must be one of: ${CASH_ADVANCE_STATUSES.join(', ')}`,
      },
      default: 'outstanding',
    },

    settledAt: {
      type:    Date,
      default: null,
    },

    // Set at Payroll GENERATION time (not settlement time) — the
    // "claim" mechanism: once a draft Payroll's generation sums an
    // employee's outstanding advances, those specific records are
    // tagged with that Payroll's _id so a later-taken advance can't
    // be accidentally swept into an already-generated payroll, and so
    // the exact same records get settled when that Payroll is paid.
    settledPayrollId: {
      type:    Schema.Types.ObjectId,
      ref:     'Payroll',
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

// The exact query Payroll generation needs: this employee's current
// outstanding, unclaimed advances.
cashAdvanceSchema.index({ tenantId: 1, employeeId: 1, status: 1, settledPayrollId: 1 })

// List/history per employee, most recent first.
cashAdvanceSchema.index({ tenantId: 1, employeeId: 1, date: -1 })

// Outlet-level reporting.
cashAdvanceSchema.index({ tenantId: 1, outletId: 1, date: -1 })

// Settlement lookup — "which advances did this payroll claim/settle".
cashAdvanceSchema.index({ tenantId: 1, settledPayrollId: 1 })

const CashAdvance = model('CashAdvance', cashAdvanceSchema)

export default CashAdvance