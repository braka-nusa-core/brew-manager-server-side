// ============================================================
// models/Employee.model.js
// v1.1 — Phase 1 extension: rider identity fields added.
// v1.2 — Payroll-config-follows-outlet extension:
//   - salaryType/baseSalary are no longer schema-required.
//     Requiredness now depends on the employee's Outlet.payrollType
//     ('fixed' → required, 'commission' → not required, stored as
//     null/0). This conditional check needs a DB read (the outlet),
//     so it is enforced in employee.service.js, NOT here and NOT in
//     employee.validation.js — see comments there.
//   - ktpStatus added (administrative tracking only — no file/image
//     upload, just a status enum).
//
// NEW FIELDS (all optional, safe defaults — backward compatible):
//   employeeType: 'barista'|'cashier'|'supervisor'|'rider'  default:'barista'
//   isRider:      Boolean  default: false
//   ktpStatus:    'pending'|'received'  default: 'pending'
//
// SYNC RULE [E3]:
//   isRider is automatically kept in sync with employeeType
//   in the service layer. When employeeType = 'rider', isRider
//   is set to true. When changed away from 'rider', isRider is
//   set to false. Both fields are stored for query convenience.
//   isRider is used as a fast filter without string comparison.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const EMPLOYEE_TYPES = ['barista', 'cashier', 'supervisor', 'rider']
const KTP_STATUSES    = ['pending', 'received']

const employeeSchema = new Schema(
  {
    // ── Tenant & Outlet Scope ─────────────────────────────────

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

    // ── Identity ──────────────────────────────────────────────

    name: {
      type:      String,
      required:  [true, 'Employee name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    phone: {
      type:    String,
      trim:    true,
      default: null,
    },

    position: {
      type:      String,
      required:  [true, 'Position is required'],
      trim:      true,
      minlength: [2,  'Position must be at least 2 characters'],
      maxlength: [50, 'Position must not exceed 50 characters'],
    },

    // ── Employee Type (Phase 1 addition) ──────────────────────
    // Classifies the employee's role within the operation.
    // When employeeType = 'rider', isRider is automatically
    // set to true by the service layer.

    employeeType: {
      type:    String,
      enum:    {
        values:  EMPLOYEE_TYPES,
        message: `employeeType must be one of: ${EMPLOYEE_TYPES.join(', ')}`,
      },
      default: 'barista',
    },

    // Convenience flag — true when employeeType = 'rider'.
    // Kept in sync by service layer. Enables fast indexed queries:
    //   Employee.find({ tenantId, isRider: true })
    // without string comparison on employeeType.
    isRider: {
      type:    Boolean,
      default: false,
    },

    // ── Salary ────────────────────────────────────────────────
    // Requiredness now depends on the employee's Outlet.payrollType:
    //   'fixed'      → salaryType + baseSalary required (enforced
    //                  in employee.service.js, which fetches the
    //                  outlet before create/update).
    //   'commission' → not required; stored as null / 0.
    // No longer `required` at the schema level so commission-outlet
    // employees can be created/updated without them. Existing
    // documents (created before this change) are untouched.

    salaryType: {
      type:    String,
      enum:    {
        values:  ['monthly', 'daily'],
        message: 'salaryType must be either "monthly" or "daily"',
      },
      default: null,
    },

    baseSalary: {
      type:     Number,
      min:      [0, 'Base salary cannot be negative'],
      default:  0,
    },

    // ── KTP Tracking (administrative status only — no file upload) ──

    ktpStatus: {
      type:    String,
      enum:    {
        values:  KTP_STATUSES,
        message: `ktpStatus must be one of: ${KTP_STATUSES.join(', ')}`,
      },
      default: 'pending',
    },

    // ── Timeline ──────────────────────────────────────────────

    joinDate: {
      type:     Date,
      required: [true, 'Join date is required'],
    },

    // ── Status ────────────────────────────────────────────────

    isActive: {
      type:    Boolean,
      default: true,
    },

    // ── Rider Portal Token (Phase 6A addition) ────────────────
    // Public, unauthenticated access token for the Rider Portal
    // (GET /api/public/rider/:token). Mirrors User.passwordHash's
    // select: false convention — never returned by any existing
    // Employee.find()/findOne() call unless explicitly selected
    // with .select('+portalToken').
    //
    // sparse: true is required — most employees are not riders
    // and will never have a token. A plain unique index would
    // reject multiple documents with portalToken: undefined;
    // sparse skips indexing documents where the field is absent.
    //
    // Generated via generatePortalToken() in employee.service.js
    // using crypto.randomBytes — never set directly via PATCH.

    portalToken: {
      type:    String,
      select:  false,
      unique:  true,
      sparse:  true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

employeeSchema.index({ tenantId: 1, outletId: 1, isActive: 1 })
employeeSchema.index({ tenantId: 1, isActive: 1 })
employeeSchema.index({ tenantId: 1, isRider: 1, isActive: 1 })  // Phase 1: rider queries
employeeSchema.index({ tenantId: 1, name: 1 })

const Employee = model('Employee', employeeSchema)

export default Employee

export { EMPLOYEE_TYPES, KTP_STATUSES }