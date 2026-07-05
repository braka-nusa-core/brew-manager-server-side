// ============================================================
// models/User.model.js
// Defines system users who can log in to BrewManager.
//
// Important distinction:
//   User  = a person who logs in (manager, admin, cashier)
//   Employee = an operational record (may not have login access)
//
// In MVP, a manager or admin MAY also be an Employee record,
// but they are separate documents by design. This separation
// allows the system to evolve (e.g. an employee who is later
// promoted to manager gets a User account created for them).
//
// Security:
//   - passwordHash is excluded from all queries by default
//     via `select: false`. It must be explicitly selected
//     with .select('+passwordHash') only when comparing passwords.
//   - email is stored lowercase and trimmed.
//   - Compound unique index { tenantId, email } enforces
//     uniqueness per tenant, not globally — the same email
//     address can be a user in two different tenants.
//
// Sprint 1 additions:
//   - 'viewer' role added (read-only, outlet-scoped)
//   - createdBy field added for audit trail
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const USER_ROLES = ['super_admin', 'tenant_admin', 'manager', 'cashier', 'viewer']

const userSchema = new Schema(
  {
    // ── Tenant & Outlet Scope ─────────────────────────────────
    // super_admin has no tenantId (null).
    // All other roles must have a tenantId.

    tenantId: {
      type:    Schema.Types.ObjectId,
      ref:     'Tenant',
      default: null,
    },

    // outletId is null for tenant_admin (all outlets).
    // Required for manager and cashier (outlet-scoped).

    outletId: {
      type:    Schema.Types.ObjectId,
      ref:     'Outlet',
      default: null,
    },

    // ── Identity ──────────────────────────────────────────────

    name: {
      type:      String,
      required:  [true, 'Name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    email: {
      type:      String,
      required:  [true, 'Email is required'],
      trim:      true,
      lowercase: true,
      match:     [/^\S+@\S+\.\S+$/, 'Email must be a valid email address'],
    },

    // ── Authentication ────────────────────────────────────────
    // select: false means passwordHash is NEVER included in
    // query results unless explicitly requested with
    // .select('+passwordHash'). This prevents accidental exposure.

    passwordHash: {
      type:     String,
      required: [true, 'Password hash is required'],
      select:   false,
    },

    // ── Role ──────────────────────────────────────────────────

    role: {
      type:     String,
      enum:     {
        values:  USER_ROLES,
        message: `Role must be one of: ${USER_ROLES.join(', ')}`,
      },
      required: [true, 'Role is required'],
    },

    // ── Status ────────────────────────────────────────────────

    isActive: {
      type:    Boolean,
      default: true,
    },

    // ── Audit ─────────────────────────────────────────────────
    // createdBy: the userId of the admin who created this account.
    // Null for accounts created via bootstrap (self-registration).
    // Immutable — never updated after creation.

    createdBy: {
      type:    Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// Unique email per tenant — same email allowed in different tenants
userSchema.index(
  { tenantId: 1, email: 1 },
  {
    unique: true,
    // Allow multiple super_admins (tenantId: null) with different emails.
    // MongoDB partial filter expression handles null tenantId correctly
    // when using a compound index — null values are indexed together,
    // which means two super_admins with the same email would conflict.
    // For MVP this is acceptable; super_admin accounts are created manually.
  }
)

// Outlet-scoped user lookup
userSchema.index({ tenantId: 1, outletId: 1, role: 1 })

const User = model('User', userSchema)

export default User