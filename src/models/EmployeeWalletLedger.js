// ============================================================
// models/EmployeeWalletLedger.model.js
// Phase 2.1 — Employee Wallet foundation.
//
// APPEND-ONLY financial ledger for Employees. One document per wallet
// movement. Mirrors the InventoryTransaction/InventoryBatch pattern
// already established for inventory: this collection is the SOURCE OF
// TRUTH, and any "current balance" is always a derived read over it,
// never a separately-stored field.
//
// Named EmployeeWalletLedger (not AllowanceLedger) because this is
// intended to become the single financial ledger for every employee
// across multiple future transaction types (daily allowance, kasbon,
// bonus, reimbursement, manual correction) — not a daily-allowance-only
// mechanism. Phase 2.1 only builds the ledger + basic transaction types;
// it does not wire any automation into it.
//
// Rules (same as InventoryTransaction):
//   - Never updated after creation.
//   - Never deleted.
//   - balanceAfter is a snapshot computed at write time from the
//     previous entry's balanceAfter + this entry's signed amount.
//     Employee.balance does NOT exist as a stored field anywhere —
//     current balance is always derived from this collection.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

// Enum kept intentionally small for Phase 2.1. Do not add types beyond
// this list without a deliberate follow-up decision — each new type is
// a new kind of financial event the ledger must be able to explain.
export const WALLET_TRANSACTION_TYPES = [
  'daily_credit',   // future: automatic per-attendance-day credit
  'withdrawal',      // employee draws down their balance
  'adjustment',       // generic signed correction
  'manual_credit',      // admin-entered credit (e.g. bonus, reimbursement — future phases)
  'manual_debit',         // admin-entered debit (e.g. kasbon — future phases)
  'migration',              // backfill / data-migration entries
]

const employeeWalletLedgerSchema = new Schema(
  {
    // ── Tenant Scope ──────────────────────────────────────────

    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    // ── Outlet (SNAPSHOT ONLY — not live-joined, not used for
    //    balance scoping; the wallet is per-employee, not per-outlet.
    //    Recorded purely for reporting/audit — "which outlet was this
    //    employee at when this transaction happened") ──────────

    outletId: {
      type:     Schema.Types.ObjectId,
      ref:      'Outlet',
      required: [true, 'Outlet ID is required'],
    },

    // ── Employee Reference (the wallet owner) ──────────────────

    employeeId: {
      type:     Schema.Types.ObjectId,
      ref:      'Employee',
      required: [true, 'Employee ID is required'],
    },

    // ── Date this transaction applies to ───────────────────────
    // Normalized to midnight UTC by the service layer, same
    // convention as Attendance.date / CupRecord.date.

    date: {
      type:     Date,
      required: [true, 'Transaction date is required'],
    },

    // ── Transaction Type ────────────────────────────────────────

    type: {
      type:     String,
      enum:     {
        values:  WALLET_TRANSACTION_TYPES,
        message: `type must be one of: ${WALLET_TRANSACTION_TYPES.join(', ')}`,
      },
      required: [true, 'type is required'],
    },

    // ── Signed amount applied to the wallet balance ─────────────
    // +amount for credits (daily_credit, manual_credit, positive
    // adjustment), -amount for debits (withdrawal, manual_debit,
    // negative adjustment). Sign convention lives in the service
    // layer — this field simply stores whatever signed value was
    // computed there.

    amount: {
      type:     Number,
      required: [true, 'amount is required'],
      validate: {
        validator: (v) => Number.isFinite(v) && v !== 0,
        message:   'amount must be a non-zero finite number',
      },
    },

    // ── Running balance snapshot AFTER this transaction is applied ──
    // balanceAfter = (previous entry's balanceAfter, or 0 if none) + amount.
    // Stored so history/reporting reads never need to replay the full
    // ledger — but the ledger itself remains the reconstructable source
    // of truth (balanceAfter values can always be recomputed from
    // amount history alone if ever needed).

    balanceAfter: {
      type:     Number,
      required: [true, 'balanceAfter is required'],
    },

    // ── Optional notes ───────────────────────────────────────────

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },

    // ── Audit: who recorded this entry ───────────────────────────

    createdBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'createdBy (userId) is required'],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // append-only, same as InventoryTransaction
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// Per-employee ledger replay, ordered by write time — the query used
// to derive "current balance" (latest balanceAfter) and full history.
employeeWalletLedgerSchema.index({ tenantId: 1, employeeId: 1, createdAt: 1 })

// "What happened on day X" lookups.
employeeWalletLedgerSchema.index({ tenantId: 1, employeeId: 1, date: 1 })

// Reporting by outlet over time (snapshot outletId — see note above).
employeeWalletLedgerSchema.index({ tenantId: 1, outletId: 1, date: -1 })

const EmployeeWalletLedger = model('EmployeeWalletLedger', employeeWalletLedgerSchema)

export default EmployeeWalletLedger