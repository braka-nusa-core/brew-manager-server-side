// ============================================================
// models/InventoryTransaction.model.js
// Sprint 6.1 — Cup Inventory & Freshness.
//
// APPEND-ONLY movement ledger for InventoryBatch. One document per stock
// movement: production, dispatch, refill, return, reject.
//
// Rules:
//   - Never updated after creation.
//   - Never deleted, EXCEPT as an application-level compensating rollback
//     within the SAME failed request that created it (e.g. FIFO dispatch
//     partially consumes batches, then fails due to insufficient overall
//     stock — the just-created transactions from that same failed call are
//     removed so no committed movement exists without a persisted request).
//     Once a request succeeds, its transactions are permanent history.
//
// batchId.quantityRemaining is always reconstructable as:
//   quantityInitial + Σ(quantityDelta for that batchId)
// quantityRemaining on InventoryBatch is a cache of this sum for fast
// FIFO reads — this collection is the source of truth.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const INVENTORY_TRANSACTION_TYPES = [
  'production',
  'dispatch',
  'refill',
  'return',
  'reject',
]

const inventoryTransactionSchema = new Schema(
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

    productId: {
      type:     Schema.Types.ObjectId,
      ref:      'Product',
      required: [true, 'Product ID is required'],
    },

    batchId: {
      type:     Schema.Types.ObjectId,
      ref:      'InventoryBatch',
      required: [true, 'batchId is required — every movement must target a physical batch'],
    },

    type: {
      type:     String,
      enum:     {
        values:  INVENTORY_TRANSACTION_TYPES,
        message: `type must be one of: ${INVENTORY_TRANSACTION_TYPES.join(', ')}`,
      },
      required: [true, 'type is required'],
    },

    // Signed delta applied to the batch's quantityRemaining.
    // +100 production, -20 dispatch, -5 refill, +3 return, -1 reject.
    quantityDelta: {
      type:     Number,
      required: [true, 'quantityDelta is required'],
      validate: {
        validator: (v) => Number.isInteger(v) && v !== 0,
        message:   'quantityDelta must be a non-zero integer',
      },
    },

    // Which CupRecord caused this movement (dispatch/refill/return/reject).
    // null for 'production' transactions (opening stock / migration), which
    // have no originating CupRecord.
    cupRecordId: {
      type:    Schema.Types.ObjectId,
      ref:     'CupRecord',
      default: null,
    },

    createdBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'createdBy (userId) is required'],
    },

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// Batch ledger lookup — "show me everything that happened to Batch A"
inventoryTransactionSchema.index({ tenantId: 1, batchId: 1, createdAt: 1 })

// Trace back from a CupRecord to the movements it caused
inventoryTransactionSchema.index({ tenantId: 1, cupRecordId: 1 })

// Reporting by outlet/product over time
inventoryTransactionSchema.index({ tenantId: 1, outletId: 1, productId: 1, createdAt: -1 })

const InventoryTransaction = model('InventoryTransaction', inventoryTransactionSchema)

export default InventoryTransaction