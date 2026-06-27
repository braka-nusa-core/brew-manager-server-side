// ============================================================
// models/BikeDamageReport.model.js
// Phase 6B — Bike Management.
//
// One bike can have many damage reports over its lifetime (history).
// Status lifecycle: OPEN → IN_REPAIR → RESOLVED, changed only via
// the dedicated PATCH /bike-damage-reports/:id/status endpoint —
// mirrors CupRecord's "use the dedicated endpoint to change status"
// convention (cup.validation.js).
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const DAMAGE_TYPES        = ['BAN_BOCOR', 'REM', 'RANTAI', 'LAINNYA']
export const DAMAGE_SEVERITIES   = ['LOW', 'MEDIUM', 'HIGH']
export const DAMAGE_REPORT_STATUSES = ['OPEN', 'IN_REPAIR', 'RESOLVED']

const bikeDamageReportSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    bikeId: {
      type:     Schema.Types.ObjectId,
      ref:      'Bike',
      required: [true, 'Bike ID is required'],
    },

    reportedBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'reportedBy (userId) is required'],
    },

    damageType: {
      type:     String,
      required: [true, 'damageType is required'],
      enum:     {
        values:  DAMAGE_TYPES,
        message: `damageType must be one of: ${DAMAGE_TYPES.join(', ')}`,
      },
    },

    severity: {
      type:     String,
      required: [true, 'severity is required'],
      enum:     {
        values:  DAMAGE_SEVERITIES,
        message: `severity must be one of: ${DAMAGE_SEVERITIES.join(', ')}`,
      },
    },

    reportedAt: {
      type:    Date,
      default: () => new Date(),
    },

    // Never settable on create — always OPEN. Changed only via
    // the dedicated /status endpoint.
    status: {
      type:    String,
      enum:    {
        values:  DAMAGE_REPORT_STATUSES,
        message: `status must be one of: ${DAMAGE_REPORT_STATUSES.join(', ')}`,
      },
      default: 'OPEN',
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

bikeDamageReportSchema.index({ tenantId: 1, bikeId: 1, status: 1 })
bikeDamageReportSchema.index({ tenantId: 1, status: 1, reportedAt: -1 })

const BikeDamageReport = model('BikeDamageReport', bikeDamageReportSchema)

export default BikeDamageReport