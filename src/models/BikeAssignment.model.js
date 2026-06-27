// ============================================================
// models/BikeAssignment.model.js
// Phase 6B — Bike Management.
//
// One rider can use one bike. History preserved — endDate: null
// means the assignment is currently active.
//
// DUAL PROTECTION against race conditions (per approved spec):
//   1. Service-layer validation (checked first, gives a clean
//      error message) — see bikeAssignment.service.js
//   2. MongoDB partial unique indexes (final protection — even
//      if two requests race past the service check simultaneously,
//      the database itself rejects the second insert)
//
// Partial unique index mechanics: a unique index with a
// partialFilterExpression only enforces uniqueness among documents
// matching that filter. Here: among documents where endDate is
// null, bikeId must be unique (one active assignment per bike)
// AND employeeId must be unique (one active assignment per rider).
// Documents with a non-null endDate (ended assignments — history)
// are excluded from this constraint entirely, so a bike/rider can
// have unlimited historical assignments, just never more than one
// concurrently active one.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const bikeAssignmentSchema = new Schema(
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

    // Must reference an Employee with isRider: true — enforced in
    // service layer (mirrors CupRecord's [CR6] rider check), not here.
    employeeId: {
      type:     Schema.Types.ObjectId,
      ref:      'Employee',
      required: [true, 'Employee ID is required'],
    },

    startDate: {
      type:     Date,
      required: [true, 'Start date is required'],
    },

    // null = currently active assignment. Set via PATCH /:assignmentId/end.
    endDate: {
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

// Standard query indexes (not unique — support filtering by
// bike/employee across all history, active or ended).
bikeAssignmentSchema.index({ tenantId: 1, bikeId: 1, endDate: 1 })
bikeAssignmentSchema.index({ tenantId: 1, employeeId: 1, endDate: 1 })

// ── Partial unique indexes — final race-condition protection ──
// Only enforced among documents where endDate is null (active
// assignments). Ended assignments (endDate set) are excluded from
// the uniqueness constraint, preserving unlimited history.

bikeAssignmentSchema.index(
  { tenantId: 1, bikeId: 1 },
  {
    unique: true,
    partialFilterExpression: { endDate: null },
    name: 'one_active_assignment_per_bike',
  }
)

bikeAssignmentSchema.index(
  { tenantId: 1, employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: { endDate: null },
    name: 'one_active_assignment_per_rider',
  }
)

const BikeAssignment = model('BikeAssignment', bikeAssignmentSchema)

export default BikeAssignment