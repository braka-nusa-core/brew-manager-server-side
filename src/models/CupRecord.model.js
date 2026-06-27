// ============================================================
// models/CupRecord.model.js
// Daily cup distribution record per rider.
//
// Structure:
//   One CupRecord per rider per date (unique index enforced).
//   Each record contains an items[] array — one entry per product.
//   Each item tracks: distributed, refill, sold, returned, reject.
//
// Status machine:
//   draft      → quantities can be updated freely (PATCH allowed)
//   finalized  → reconciliation passed, record is immutable
//
// Reconciliation rule (per item, enforced at finalize):
//   (distributed + refill) === (sold + returned + reject)
//   balance = 0 means fully accounted
//
// Balance is NOT stored — it is computed in service on read.
// Storing it risks sync issues if items are updated.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const CUP_RECORD_STATUSES = ['draft', 'finalized']

// ── Embedded item schema ──────────────────────────────────────

const cupItemSchema = new Schema(
  {
    productId: {
      type:     Schema.Types.ObjectId,
      ref:      'Product',
      required: [true, 'Product ID is required per item'],
    },

    // Cups given out to rider at start of day
    distributed: {
      type:    Number,
      default: 0,
      min:     [0, 'distributed cannot be negative'],
    },

    // Additional cups given during the day (separate refill event)
    refill: {
      type:    Number,
      default: 0,
      min:     [0, 'refill cannot be negative'],
    },

    // Cups confirmed sold to customers
    sold: {
      type:    Number,
      default: 0,
      min:     [0, 'sold cannot be negative'],
    },

    // Cups brought back unsold
    returned: {
      type:    Number,
      default: 0,
      min:     [0, 'returned cannot be negative'],
    },

    // Damaged or unsellable cups
    reject: {
      type:    Number,
      default: 0,
      min:     [0, 'reject cannot be negative'],
    },
  },
  {
    _id: false,   // suppress auto _id on subdocuments
  }
)

// ── CupRecord schema ──────────────────────────────────────────

const cupRecordSchema = new Schema(
  {
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

    // Must be an Employee with isRider: true
    // Enforced in service layer, not model layer
    riderId: {
      type:     Schema.Types.ObjectId,
      ref:      'Employee',
      required: [true, 'Rider ID is required'],
    },

    // Normalized to midnight UTC in service layer
    date: {
      type:     Date,
      required: [true, 'Date is required'],
    },

    // At least one product item required
    items: {
      type:     [cupItemSchema],
      default:  [],
      validate: {
        validator: (arr) => arr.length >= 1,
        message:   'At least one product item is required',
      },
    },

    // draft → freely editable
    // finalized → immutable, reconciliation passed
    status: {
      type:    String,
      enum:    {
        values:  CUP_RECORD_STATUSES,
        message: 'status must be "draft" or "finalized"',
      },
      default: 'draft',
    },

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },

    // Who created/last updated this record
    recordedBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'recordedBy (userId) is required'],
    },

    // Set when status transitions to 'finalized'
    finalizedBy: {
      type:    Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    finalizedAt: {
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

// PRIMARY: one record per rider per date (unique constraint)
cupRecordSchema.index(
  { tenantId: 1, riderId: 1, date: 1 },
  { unique: true }
)

// Outlet-level queries (reconciliation, outlet summary)
cupRecordSchema.index({ tenantId: 1, outletId: 1, date: -1 })

// Status filter (find all drafts for closing)
cupRecordSchema.index({ tenantId: 1, status: 1 })

// Date range queries
cupRecordSchema.index({ tenantId: 1, date: -1 })

const CupRecord = model('CupRecord', cupRecordSchema)

export default CupRecord