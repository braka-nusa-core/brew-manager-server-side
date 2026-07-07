// ============================================================
// models/Plan.model.js
// Defines the available subscription plans for BrewManager SaaS.
//
// Source of truth: Braka Nusa Core pricing sheet (2024).
//   Starter  — IDR 299k/month  — 1 outlet, 15 employees, 1 admin
//   Growth   — IDR 599k/month  — 3 outlets, 60 employees, 3 admins
//   Business — IDR 1.2M/month  — 8 outlets, 200 employees, 10 admins
//
// Design decisions:
//   - Plans are managed ONLY by super_admin via MANAGE_PLANS.
//   - limits.maxAdmins counts Users with role manager/cashier/viewer.
//     tenant_admin is always exactly 1 — not counted against maxAdmins.
//   - limits.maxEmployees counts active Employee documents.
//   - limits.maxOutlets counts non-deleted Outlet documents.
//   - limits.maxBikes and limits.maxProducts are admin-managed
//     caps; no pricing tier exposes these to clients currently.
//   - -1 on any limit means unlimited.
//   - feature flags are backend-enforced (never frontend-decided).
//   - price is display/billing-reference only — no payment gateway.
//   - sortOrder controls display order: Starter=0, Growth=1, Business=2.
//
// Sprint 2 — Subscription & Plan Management
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const PLAN_SLUGS = ['starter', 'growth', 'business']

const planSchema = new Schema(
  {
    // ── Identity ──────────────────────────────────────────────

    name: {
      type:      String,
      required:  [true, 'Plan name is required'],
      trim:      true,
      maxlength: [60, 'Plan name must not exceed 60 characters'],
    },

    slug: {
      type:      String,
      required:  [true, 'Plan slug is required'],
      trim:      true,
      lowercase: true,
      enum: {
        values:  PLAN_SLUGS,
        message: `slug must be one of: ${PLAN_SLUGS.join(', ')}`,
      },
    },

    description: {
      type:    String,
      trim:    true,
      default: null,
    },

    // ── Pricing (display only — manual billing) ───────────────

    price: {
      type:    Number,
      default: 0,
      min:     [0, 'price cannot be negative'],
    },

    // ── Resource Limits ───────────────────────────────────────
    // -1 = unlimited for any field.

    limits: {
      // Active non-deleted Outlet documents per tenant
      maxOutlets: {
        type:    Number,
        default: 1,
        min:     [-1, 'Use -1 for unlimited'],
      },
      // Active Employee documents per tenant (riders + baristas + all types)
      maxEmployees: {
        type:    Number,
        default: 15,
        min:     [-1, 'Use -1 for unlimited'],
      },
      // User documents with role manager/cashier/viewer per tenant.
      // tenant_admin (1) is always permitted and NOT counted here.
      maxAdmins: {
        type:    Number,
        default: 1,
        min:     [-1, 'Use -1 for unlimited'],
      },
      // Bike documents (non-deleted) per tenant
      maxBikes: {
        type:    Number,
        default: -1,   // currently unlimited across all plans
        min:     [-1, 'Use -1 for unlimited'],
      },
      // Product documents (non-deleted) per tenant
      maxProducts: {
        type:    Number,
        default: -1,   // currently unlimited across all plans
        min:     [-1, 'Use -1 for unlimited'],
      },
    },

    // ── Feature Flags ─────────────────────────────────────────
    // Backend enforced. False = feature is unavailable on this plan.
    // Feature names map exactly to the pricing sheet:

    features: {
      // Core features — available on all plans
      attendance:       { type: Boolean, default: true  },
      salesTracking:    { type: Boolean, default: true  },
      expenseTracking:  { type: Boolean, default: true  },
      payrollBasic:     { type: Boolean, default: true  },
      dashboardBasic:   { type: Boolean, default: true  },
      riderPortal:      { type: Boolean, default: true  },

      // Growth+ features
      outletPerformance: { type: Boolean, default: false },
      advancedDashboard: { type: Boolean, default: false },

      // Business-only features
      customReports:     { type: Boolean, default: false },
      businessAnalytics: { type: Boolean, default: false },
      payrollAdvanced:   { type: Boolean, default: false },
    },

    // ── Add-on Unit Prices ────────────────────────────────────
    // Per-unit monthly prices for add-ons purchasable by the tenant.
    // Super admin sets these. Used for billing reference only.

    addOnPrices: {
      perExtraOutlet:   { type: Number, default: 75000,  min: 0 },
      // per 10 employees block
      perExtraEmployee: { type: Number, default: 25000,  min: 0 },
      perExtraAdmin:    { type: Number, default: 50000,  min: 0 },
    },

    // ── Metadata ──────────────────────────────────────────────

    // Display order on plan selection pages (lower = first)
    sortOrder: {
      type:    Number,
      default: 0,
      min:     0,
    },

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

planSchema.index({ slug: 1 }, { unique: true })
planSchema.index({ isActive: 1, sortOrder: 1 })

const Plan = model('Plan', planSchema)

export default Plan