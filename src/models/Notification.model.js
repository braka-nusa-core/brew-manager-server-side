// ============================================================
// models/Notification.model.js
// Notification Center MVP — in-app notifications for
// authenticated Users.
//
// APPROVED ARCHITECTURE (final — see Notification Center
// Phase 2 review + approved decisions):
//   - Direct-to-user only. No role/outlet/global broadcast.
//   - userId is the SOLE ownership/authorization boundary.
//     Every query in notification.service.js filters by userId
//     alone — mirrors auth.service.js's getCurrentUser() pattern
//     (authenticate only, no authorize(), no tenantGuard).
//   - tenantId is stored for defense-in-depth/reporting only.
//     It is NEVER used to scope a user's own notification reads.
//   - No soft delete. Notifications are disposable — DELETE is a
//     hard delete ("dismiss"). This is a deliberate deviation
//     from this codebase's usual isActive/deletedAt convention,
//     approved for this module specifically.
//   - relatedEntity is an optional polymorphic pointer
//     (entityType string + entityId ObjectId) for click-through
//     context. No `ref` is declared — entityType varies
//     (Outlet, Employee, BikeDamageReport, ...) and Mongoose
//     does not support a dynamic `ref`.
//   - waText / waLink are optional WhatsApp hand-off fields.
//     Approved decision: NO WhatsApp API integration anywhere in
//     this codebase. These are only ever a pre-filled wa.me link
//     + its text; the frontend opens it manually. Null on
//     notification types with no WhatsApp angle (e.g.
//     payroll_generated).
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

// Extensibility seam: adding a new trigger later means appending
// one value here plus one new exported notifyX() function in
// notification.service.js — no other file needs to change.
export const NOTIFICATION_TYPES = [
  'payroll_generated',
  'rider_bonus_achieved',
  'bike_maintenance_overdue',
]

const notificationSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    // Recipient. See header note — this is the entire
    // authorization boundary for this module.
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID (recipient) is required'],
    },

    type: {
      type:     String,
      required: [true, 'Notification type is required'],
      enum: {
        values:  NOTIFICATION_TYPES,
        message: `type must be one of: ${NOTIFICATION_TYPES.join(', ')}`,
      },
    },

    title: {
      type:      String,
      required:  [true, 'Title is required'],
      trim:      true,
      maxlength: [150, 'Title must not exceed 150 characters'],
    },

    message: {
      type:      String,
      required:  [true, 'Message is required'],
      trim:      true,
      maxlength: [1000, 'Message must not exceed 1000 characters'],
    },

    // Optional polymorphic pointer — see header note.
    relatedEntity: {
      entityType: { type: String, default: null },
      entityId:   { type: Schema.Types.ObjectId, default: null },
    },

    // WhatsApp hand-off — see header note. Null when not
    // applicable to a given notification type.
    waText: {
      type:    String,
      default: null,
    },

    waLink: {
      type:    String,
      default: null,
    },

    isRead: {
      type:    Boolean,
      default: false,
    },

    readAt: {
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

// Primary: "my notifications" list, newest first
notificationSchema.index({ userId: 1, createdAt: -1 })

// Unread list / unread count
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 })

// Dedupe lookups for idempotent triggers (e.g. bike maintenance
// overdue, which is re-evaluated on every dashboard read and must
// not create a duplicate notification for the same report).
// sparse — most notification types have no relatedEntity at all.
notificationSchema.index(
  { type: 1, 'relatedEntity.entityId': 1 },
  { sparse: true }
)

const Notification = model('Notification', notificationSchema)

export default Notification
