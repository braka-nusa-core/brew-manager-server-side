// ============================================================
// models/Sale.model.js
// v1.1 — Phase 1 extension: paymentMethod field added.
//
// NEW FIELD:
//   paymentMethod: 'cash'|'transfer'|'qris'  optional, default null
//
// All existing fields unchanged. paymentMethod is optional so
// existing sale records without it remain valid.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const PAYMENT_METHODS = ['cash', 'transfer', 'qris']
const SALE_ORIGINS    = ['manual', 'system']

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

    // ── Payment Method (Phase 1 addition) ─────────────────────
    // Optional — existing records without this field are valid.
    // Used for payment breakdown reporting.

    paymentMethod: {
      type:    String,
      enum:    {
        values:  PAYMENT_METHODS,
        message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}`,
      },
      default: null,
    },

    // ── Optional ──────────────────────────────────────────────

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },

    // ── Phase 1: automatic Sale generation from CupRecord ──────
    // origin: 'manual' (existing behavior, default) or 'system'
    // (auto-generated on CupRecord finalize).
    // sourceCupRecordId: set only for origin='system'. Unique+sparse
    // so a CupRecord can generate at most one Sale (idempotent finalize).
    // Both fields are optional/nullable — fully backward compatible
    // with existing Sale documents and the manual createSale() flow.

    origin: {
      type:    String,
      enum:    {
        values:  SALE_ORIGINS,
        message: `origin must be one of: ${SALE_ORIGINS.join(', ')}`,
      },
      default: 'manual',
    },

    sourceCupRecordId: {
      type:    Schema.Types.ObjectId,
      ref:     'CupRecord',
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

saleSchema.index({ tenantId: 1, outletId: 1, date: -1 })
saleSchema.index({ tenantId: 1, employeeId: 1, date: -1 })
saleSchema.index({ tenantId: 1, date: -1 })

// Phase 1: one Sale per CupRecord (sparse — only applies to docs
// that actually have a sourceCupRecordId, i.e. system-generated ones).
saleSchema.index({ sourceCupRecordId: 1 }, { unique: true, sparse: true })

const Sale = model('Sale', saleSchema)

export default Sale

export { PAYMENT_METHODS, SALE_ORIGINS }