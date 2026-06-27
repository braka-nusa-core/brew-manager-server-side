// ============================================================
// models/BikeRepairRecord.model.js
// Phase 6B — Bike Management.
//
// One damage report can have multiple repair attempts over time
// (e.g. a first repair that didn't fully fix the issue, followed
// by a second) — hence a separate collection referencing
// damageReportId, not an embedded array on BikeDamageReport.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const REPAIR_STATUSES = ['IN_PROGRESS', 'COMPLETED']

const bikeRepairRecordSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    damageReportId: {
      type:     Schema.Types.ObjectId,
      ref:      'BikeDamageReport',
      required: [true, 'damageReportId is required'],
    },

    repairDate: {
      type:     Date,
      required: [true, 'repairDate is required'],
    },

    cost: {
      type:     Number,
      required: [true, 'cost is required'],
      min:      [0, 'cost cannot be negative'],
    },

    repairStatus: {
      type:    String,
      enum:    {
        values:  REPAIR_STATUSES,
        message: `repairStatus must be one of: ${REPAIR_STATUSES.join(', ')}`,
      },
      default: 'IN_PROGRESS',
    },

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

bikeRepairRecordSchema.index({ tenantId: 1, damageReportId: 1 })

const BikeRepairRecord = model('BikeRepairRecord', bikeRepairRecordSchema)

export default BikeRepairRecord