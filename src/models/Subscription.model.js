// ============================================================
// models/Subscription.model.js
// Links exactly ONE Tenant to exactly ONE Plan.
//
// Design decisions:
//   - One subscription per tenant, enforced by unique index on tenantId.
//   - planId references the LIVE Plan document — limit checks always
//     read Plan.limits at query time, never a stale snapshot.
//     planSlug is stored only for quick display without populate.
//   - Effective limits = Plan.limits + addOns (computed at check time,
//     never stored — avoids stale data).
//   - Add-ons are tenant-specific overrides purchased outside the plan:
//       addOns.extraOutlets:   integer, count of additional outlets
//       addOns.extraEmployees: integer, additional employee slots
//       addOns.extraAdmins:    integer, additional admin slots
//   - maintenanceUntil: date until which free maintenance is included
//     (e.g. Growth = +1 month, Business = +3 months from startedAt).
//     Null = no maintenance included. Display/reference only.
//   - billingCycle and expiredAt are reference data for manual billing.
//     No automatic renewal logic exists.
//   - status 'trial' = new tenant not yet on a paid plan.
//
// Sprint 2 — Subscription & Plan Management
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'expired', 'cancelled']
export const BILLING_CYCLES        = ['monthly', 'annual', 'lifetime']

const subscriptionSchema = new Schema(
  {
    // ── Core References ───────────────────────────────────────

    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    planId: {
      type:     Schema.Types.ObjectId,
      ref:      'Plan',
      required: [true, 'Plan ID is required'],
    },

    // Denormalized plan slug for display without populate.
    // Always kept in sync with planId → Plan.slug.
    planSlug: {
      type:     String,
      required: [true, 'Plan slug is required'],
      trim:     true,
      lowercase: true,
    },

    // ── Status & Billing ──────────────────────────────────────

    status: {
      type:    String,
      enum:    { values: SUBSCRIPTION_STATUSES, message: `status must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}` },
      default: 'trial',
    },

    billingCycle: {
      type:    String,
      enum:    { values: BILLING_CYCLES, message: `billingCycle must be one of: ${BILLING_CYCLES.join(', ')}` },
      default: 'monthly',
    },

    startedAt: {
      type:     Date,
      required: [true, 'startedAt is required'],
    },

    // Null = no fixed expiry (lifetime / trial with no end date)
    expiredAt: {
      type:    Date,
      default: null,
    },

    // Date until which free maintenance support is included.
    // Null = no maintenance window.
    // Set by super_admin when approving subscription or upgrade.
    maintenanceUntil: {
      type:    Date,
      default: null,
    },

    autoRenew: {
      type:    Boolean,
      default: true,
    },

    // ── Add-ons ───────────────────────────────────────────────
    // Additional resource slots purchased on top of the plan.
    // Effective limit = Plan.limits.maxX + addOns.extraX
    // All default to 0 (no add-ons).

    addOns: {
      // Extra outlet slots (each billed at Plan.addOnPrices.perExtraOutlet/month)
      extraOutlets: {
        type:    Number,
        default: 0,
        min:     [0, 'extraOutlets cannot be negative'],
      },
      // Extra employee slots (billed per 10-employee block)
      extraEmployees: {
        type:    Number,
        default: 0,
        min:     [0, 'extraEmployees cannot be negative'],
      },
      // Extra admin (manager/cashier/viewer) slots
      extraAdmins: {
        type:    Number,
        default: 0,
        min:     [0, 'extraAdmins cannot be negative'],
      },
    },

    // ── Admin Notes ───────────────────────────────────────────

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

// One subscription per tenant
subscriptionSchema.index({ tenantId: 1 }, { unique: true })
subscriptionSchema.index({ planId: 1 })
subscriptionSchema.index({ status: 1, expiredAt: 1 })

const Subscription = model('Subscription', subscriptionSchema)

export default Subscription