// ============================================================
// models/Attendance.model.js
// Defines the Attendance schema for BrewManager.
//
// Design decisions:
//   - One attendance record per employee per day, enforced by
//     a unique compound index: { tenantId, employeeId, date }.
//   - date is stored as a normalized Date (midnight UTC) so
//     the unique index works correctly regardless of timezone.
//   - No clock-in/clock-out fields — MVP is status-based only.
//   - recordedBy references the User who submitted the record,
//     preserving audit trail for who input each entry.
//   - Soft delete is NOT used on attendance — admins may hard
//     delete incorrect entries and re-submit. History integrity
//     is maintained through the unique constraint preventing
//     accidental duplicate re-entry.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave', 'holiday']

const attendanceSchema = new Schema(
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

    // ── Employee Reference ────────────────────────────────────

    employeeId: {
      type:     Schema.Types.ObjectId,
      ref:      'Employee',
      required: [true, 'Employee ID is required'],
    },

    // ── Attendance Date ───────────────────────────────────────
    // Stored as a Date. The service normalizes this to midnight
    // UTC before saving to ensure uniqueness per calendar day.

    date: {
      type:     Date,
      required: [true, 'Attendance date is required'],
    },

    // ── Status ────────────────────────────────────────────────

    status: {
      type:     String,
      enum:     {
        values:  ATTENDANCE_STATUSES,
        message: `Status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`,
      },
      required: [true, 'Attendance status is required'],
    },

    // ── Notes ─────────────────────────────────────────────────

    notes: {
      type:    String,
      trim:    true,
      default: null,
    },

    // ── Audit: who recorded this entry ───────────────────────

    recordedBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Recorded by (userId) is required'],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// PRIMARY UNIQUE CONSTRAINT:
// One attendance record per employee per day per tenant.
// MongoDB will reject duplicate inserts at the DB level.
// The service also performs pre-insert checks for cleaner errors.
attendanceSchema.index(
  { tenantId: 1, employeeId: 1, date: 1 },
  { unique: true }
)

// List query: tenant → outlet → date (most common report pattern)
attendanceSchema.index({ tenantId: 1, outletId: 1, date: 1 })

// Per-employee history query
attendanceSchema.index({ tenantId: 1, employeeId: 1 })

const Attendance = model('Attendance', attendanceSchema)

export default Attendance
