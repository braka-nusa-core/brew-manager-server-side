// ============================================================
// models/Employee.model.js
// Defines the Employee schema for BrewManager.
//
// Design decisions:
//   - Employees are operational records ONLY in MVP.
//     They do NOT have login access. They are NOT Users.
//   - tenantId + outletId are mandatory on every document.
//   - passwordHash is intentionally absent — employees don't auth.
//   - Soft delete via isActive — hard delete is NEVER used.
//   - passwordHash absent by design — employees are not users.
//   - Compound indexes defined for the three most common query patterns.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const SALARY_TYPES = ['monthly', 'daily']

const employeeSchema = new Schema(
  {
    // ── Tenant & Outlet Scope ─────────────────────────────────
    // Both are required. No employee document can exist outside
    // a tenant or without outlet assignment.

    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
      index:    true,
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
      minlength: [2,  'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    phone: {
      type:  String,
      trim:  true,
      default: null,
    },

    // ── Role & Position ───────────────────────────────────────
    // Free-text string (not enum) to allow tenant-specific
    // position names (e.g. "head barista", "shift lead").
    // Validation enforces min/max length only.

    position: {
      type:      String,
      required:  [true, 'Position is required'],
      trim:      true,
      minlength: [2,  'Position must be at least 2 characters'],
      maxlength: [50, 'Position must not exceed 50 characters'],
    },

    // ── Salary Configuration ──────────────────────────────────

    salaryType: {
      type:     String,
      enum:     {
        values:  SALARY_TYPES,
        message: `Salary type must be one of: ${SALARY_TYPES.join(', ')}`,
      },
      required: [true, 'Salary type is required'],
    },

    baseSalary: {
      type:     Number,
      required: [true, 'Base salary is required'],
      min:      [0, 'Base salary cannot be negative'],
    },

    // ── Dates ─────────────────────────────────────────────────

    joinDate: {
      type:     Date,
      required: [true, 'Join date is required'],
    },

    // ── Status ────────────────────────────────────────────────
    // Soft delete flag. Setting isActive = false deactivates
    // the employee record but preserves it for payroll history.

    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
    versionKey: false,
  }
)

// ── Compound Indexes ─────────────────────────────────────────
// Defined as compound indexes with tenantId first (leftmost prefix).
// This makes tenant-scoped queries on outletId, name, and isActive
// fast regardless of total document count.

// Primary list query: tenant → outlet
employeeSchema.index({ tenantId: 1, outletId: 1 })

// Search by name within a tenant
employeeSchema.index({ tenantId: 1, name: 1 })

// Filter active/inactive employees within a tenant
employeeSchema.index({ tenantId: 1, isActive: 1 })

const Employee = model('Employee', employeeSchema)

export default Employee
