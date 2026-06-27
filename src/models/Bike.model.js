// ============================================================
// models/Bike.model.js
// Phase 6B — Bike Management.
//
// TWO SEPARATE STATUS CONCEPTS — do not conflate:
//   status:   operational condition (ACTIVE/MAINTENANCE/RETIRED)
//             — a business state, changed only via the dedicated
//             PATCH /:bikeId/status endpoint, never via generic update.
//   isActive: soft-delete flag — infrastructure concept, changed
//             only via DELETE /:bikeId (sets false). Never deletedAt.
//
// A RETIRED bike still has isActive: true — it remains visible in
// history (past assignments, damage reports). isActive: false means
// the record itself was a data-entry mistake being corrected, a
// distinct action from RETIRED. Mirrors Outlet's deletedAt-vs-isActive
// two-tier reasoning, but without deletedAt — Bike has no cascading
// operational dependents that require that extra permanence marker.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const BIKE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED']

const bikeSchema = new Schema(
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

    assetCode: {
      type:      String,
      required:  [true, 'Asset code is required'],
      trim:      true,
      uppercase: true,
      minlength: [2,  'Asset code must be at least 2 characters'],
      maxlength: [20, 'Asset code must not exceed 20 characters'],
    },

    name: {
      type:      String,
      required:  [true, 'Bike name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    // Operational condition. Never settable on create (always
    // ACTIVE) or via generic PATCH — only via PATCH /:bikeId/status.
    status: {
      type:    String,
      enum:    {
        values:  BIKE_STATUSES,
        message: `status must be one of: ${BIKE_STATUSES.join(', ')}`,
      },
      default: 'ACTIVE',
    },

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },

    // Soft-delete flag. See header note — distinct from `status`.
    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

bikeSchema.index({ tenantId: 1, assetCode: 1 }, { unique: true })
bikeSchema.index({ tenantId: 1, outletId: 1, isActive: 1 })
bikeSchema.index({ tenantId: 1, status: 1 })

const Bike = model('Bike', bikeSchema)

export default Bike