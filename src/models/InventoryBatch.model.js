// ============================================================
// models/InventoryBatch.model.js
// Sprint 6.1 — Cup Inventory & Freshness.
// Sprint 6.2 (final revision) — status no longer represents expiry.
//
// Represents ONE physical production batch of a product at an outlet.
//
// IDENTITY RULES (critical — do not violate in service code):
//   - producedAt      : IMMUTABLE. Set once at creation. This is the ONLY
//                        freshness anchor for the batch. It NEVER changes,
//                        including when units are returned to this batch.
//   - quantityInitial : IMMUTABLE. Total units this batch ever had.
//   - quantityRemaining: MUTABLE — but ONLY ever changed as the result of
//                        writing a corresponding InventoryTransaction. Never
//                        edited standalone/directly by any service function.
//   - status          : MUTABLE — represents INVENTORY LIFECYCLE ONLY
//                        ('active' | 'depleted'). It never represents
//                        expiry/freshness — that is ALWAYS computed on
//                        read via inventory.service.js's isExpiredByAge()/
//                        getFreshnessLabel(), never stored here and never
//                        mutated during a read.
//
// There is deliberately NO "origin" field, NO return-batch variant, NO
// migration-batch variant. A batch is a batch — returns/rejects/dispatches
// are all just transactions against the same physical batch document.
//
// Freshness rule (business requirement, computed from producedAt only —
// see inventory.service.js getFreshnessLabel/isExpiredByAge, NOT status):
//   Day 0–1   → safe
//   Day 2     → safe
//   Day 3     → warning
//   Day 4+    → expired — FIFO excludes it via isExpiredByAge(), regardless
//               of `status`, which stays 'active' until genuinely depleted.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const INVENTORY_BATCH_STATUSES = ['active', 'depleted']

const inventoryBatchSchema = new Schema(
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

    // IMMUTABLE — the sole freshness anchor. Never reassigned after creation,
    // including when units are returned to this batch via InventoryTransaction.
    producedAt: {
      type:     Date,
      required: [true, 'producedAt is required'],
      immutable: true,
    },

    // IMMUTABLE — total units this batch was created with.
    quantityInitial: {
      type:      Number,
      required:  [true, 'quantityInitial is required'],
      min:       [0, 'quantityInitial cannot be negative'],
      immutable: true,
    },

    // MUTABLE — current available units. Only ever changed by consuming
    // (FIFO dispatch/refill), crediting (return), or debiting (reject) via
    // an InventoryTransaction. Never edited directly.
    quantityRemaining: {
      type:    Number,
      required: [true, 'quantityRemaining is required'],
      min:     [0, 'quantityRemaining cannot be negative'],
    },

    // Inventory LIFECYCLE only — NOT an expiry indicator.
    // active    → has remaining quantity (may still be too old to dispatch —
    //             that is decided at consumption time via isExpiredByAge(),
    //             never reflected here).
    // depleted  → quantityRemaining reached 0 (can return to active if credited).
    status: {
      type:    String,
      enum:    {
        values:  INVENTORY_BATCH_STATUSES,
        message: `status must be one of: ${INVENTORY_BATCH_STATUSES.join(', ')}`,
      },
      default: 'active',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// PRIMARY: FIFO consumption query — active batches for a product at an
// outlet, oldest producedAt first.
inventoryBatchSchema.index({ tenantId: 1, outletId: 1, productId: 1, status: 1, producedAt: 1 })

// General lookups
inventoryBatchSchema.index({ tenantId: 1, outletId: 1, productId: 1 })

const InventoryBatch = model('InventoryBatch', inventoryBatchSchema)

export default InventoryBatch