// ============================================================
// models/UpgradeRequest.model.js
// Tracks tenant requests to upgrade to a higher plan.
//
// Workflow:
//   1. tenant_admin: POST /upgrade-requests
//      → status: 'pending'
//      → notifies all super_admin users via Notification Center
//   2. super_admin: PATCH /upgrade-requests/:id/approve
//      → status: 'approved'
//      → Subscription.planId updated to toPlanId
//      → Tenant.plan label synced to new plan slug
//      → tenant_admin notified
//   3. super_admin: PATCH /upgrade-requests/:id/reject
//      → status: 'rejected'
//      → tenant_admin notified
//
// No automatic payment. Approval is fully manual.
// Only one PENDING request per tenant is allowed at a time
// (enforced in service layer, not at DB level — rare enough).
//
// Sprint 2 — Subscription & Plan Management
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const UPGRADE_REQUEST_STATUSES = ['pending', 'approved', 'rejected']

const upgradeRequestSchema = new Schema(
  {
    // ── Parties ───────────────────────────────────────────────

    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    // The tenant_admin who submitted the request
    requestedBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'requestedBy is required'],
    },

    // ── Plan References ───────────────────────────────────────

    fromPlanId: {
      type:     Schema.Types.ObjectId,
      ref:      'Plan',
      required: [true, 'fromPlanId is required'],
    },

    toPlanId: {
      type:     Schema.Types.ObjectId,
      ref:      'Plan',
      required: [true, 'toPlanId is required'],
    },

    // Slug snapshots for display without populate
    fromPlanSlug: {
      type:    String,
      trim:    true,
      default: null,
    },

    toPlanSlug: {
      type:    String,
      trim:    true,
      default: null,
    },

    // ── Status & Resolution ───────────────────────────────────

    status: {
      type:    String,
      enum:    { values: UPGRADE_REQUEST_STATUSES, message: `status must be one of: ${UPGRADE_REQUEST_STATUSES.join(', ')}` },
      default: 'pending',
    },

    // Optional reason from the tenant_admin
    reason: {
      type:    String,
      trim:    true,
      default: null,
    },

    // super_admin response notes
    adminNotes: {
      type:    String,
      trim:    true,
      default: null,
    },

    // The super_admin who actioned the request
    resolvedBy: {
      type:    Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    resolvedAt: {
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

upgradeRequestSchema.index({ tenantId: 1, status: 1 })
upgradeRequestSchema.index({ status: 1, createdAt: -1 })

const UpgradeRequest = model('UpgradeRequest', upgradeRequestSchema)

export default UpgradeRequest