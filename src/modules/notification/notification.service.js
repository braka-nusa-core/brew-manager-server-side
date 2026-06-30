// ============================================================
// modules/notification/notification.service.js
// Notification Center — MVP.
//
// APPROVED ARCHITECTURE (final — see Phase 2 review + approved
// decisions):
//   1. Direct-to-user only. No broadcast.
//   2. Ownership-only authorization — every read/write below is
//      scoped by userId alone, never by tenantId/role/permission.
//      Mirrors auth.service.js's getCurrentUser().
//   3. No public create endpoint. Notifications are created
//      exclusively by the trigger functions exported below,
//      called from other modules' services (payroll, bike).
//   4. In-app REST only. waText/waLink are pre-filled wa.me
//      hand-off data — no WhatsApp API call is ever made.
//   5. No background jobs. Every notification is created
//      synchronously inside an existing business-event code path.
//      "Bike maintenance overdue" is evaluated lazily at read
//      time (see notifyBikeMaintenanceOverdue) since there is no
//      scheduler to evaluate it on a timer.
//   6. EXTENSIBILITY SEAM: to add a new trigger later, add one
//      value to NOTIFICATION_TYPES (Notification.model.js) and
//      one exported notifyX() function below that calls the
//      private createNotification() primitive. No controller,
//      route, or model structure change required.
//
// Trigger functions (notifyX, bottom of file) never throw — a
// notification failure must never break the business operation
// that triggered it. Errors are logged and swallowed.
// ============================================================

import mongoose      from 'mongoose'
import Notification  from '../../models/Notification.model.js'
import User          from '../../models/User.model.js'
import ApiError       from '../../utils/ApiError.js'
import logger         from '../../utils/logger.js'
import { ROLES }      from '../../constants/permissions.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── Bike maintenance overdue threshold ──────────────────────────
// Single-module constant — not promoted to config/ since this is
// currently the only threshold this module needs. Easily moved to
// a config/notification.config.js later if more are added.
const BIKE_MAINTENANCE_OVERDUE_DAYS = 3

// ════════════════════════════════════════════════════════════════
// READ-SIDE — owner-scoped queries (req.user.userId only)
// ════════════════════════════════════════════════════════════════

// ── getNotifications ──────────────────────────────────────────

/**
 * Paginated list of the authenticated user's own notifications.
 *
 * @param {string} userId - req.user.userId
 * @param {Object} queryParams - req.query: { page, limit, isRead }
 */
export const getNotifications = async (userId, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = { userId: new mongoose.Types.ObjectId(userId) }

  if (queryParams.isRead !== undefined) {
    filter.isRead = queryParams.isRead === 'true'
  }

  const [notifications, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ])

  return {
    notifications,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getUnreadCount ────────────────────────────────────────────

export const getUnreadCount = async (userId) => {
  return Notification.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    isRead: false,
  })
}

// ── markAsRead ────────────────────────────────────────────────

export const markAsRead = async (userId, notificationId) => {
  const notification = await Notification.findOneAndUpdate(
    {
      _id:    new mongoose.Types.ObjectId(notificationId),
      userId: new mongoose.Types.ObjectId(userId),
    },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  ).lean()

  if (!notification) throw new ApiError(404, 'Notification not found')

  return notification
}

// ── markAllAsRead ─────────────────────────────────────────────

export const markAllAsRead = async (userId) => {
  const result = await Notification.updateMany(
    { userId: new mongoose.Types.ObjectId(userId), isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  )

  return {
    matched:  result.matchedCount  ?? 0,
    modified: result.modifiedCount ?? 0,
  }
}

// ── deleteNotification ────────────────────────────────────────
// Hard delete ("dismiss"). See Notification.model.js header note
// on why this module has no soft-delete convention.

export const deleteNotification = async (userId, notificationId) => {
  const notification = await Notification.findOneAndDelete({
    _id:    new mongoose.Types.ObjectId(notificationId),
    userId: new mongoose.Types.ObjectId(userId),
  }).lean()

  if (!notification) throw new ApiError(404, 'Notification not found')
}

// ════════════════════════════════════════════════════════════════
// WRITE-SIDE — internal only, never exposed via a route
// ════════════════════════════════════════════════════════════════

/**
 * Internal primitive. Not exported — every write goes through one
 * of the notifyX() trigger functions below, which own the `type`
 * taxonomy and message format. Keeping this private prevents any
 * caller from creating a notification with an ad-hoc shape.
 */
const createNotification = async (fields) => {
  return Notification.create(fields)
}

/**
 * Returns User _ids for the manager(s) of the given outlet plus
 * the tenant_admin(s) of the given tenant.
 *
 * Used by triggers whose real-world subject (a rider, a bike) has
 * no User account of their own — outlet staff are notified instead
 * (see Phase 2 review §3: only User documents can be recipients).
 */
const findOutletStakeholderUserIds = async (tenantId, outletId) => {
  const users = await User.find({
    tenantId,
    isActive: true,
    $or: [
      { role: ROLES.TENANT_ADMIN },
      { role: ROLES.MANAGER, outletId },
    ],
  }).select('_id').lean()

  return users.map((u) => u._id)
}

/**
 * Generates a pre-filled wa.me hand-off link. NO WhatsApp API call
 * is made — see Notification.model.js header note.
 *
 * Returns null fields (never throws) if phone is missing — the
 * WhatsApp hand-off is a bonus on top of the notification, never
 * a blocker for creating it.
 *
 * Phone normalization assumption (documented, isolated to this
 * function): strips non-digits; a leading '0' is treated as the
 * Indonesian local trunk prefix and replaced with country code 62.
 * Adjust here only if a different default locale is needed later.
 */
const buildWhatsAppFields = (phone, text) => {
  if (!phone) return { waText: null, waLink: null }

  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`

  const waLink = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`

  return { waText: text, waLink }
}

// ════════════════════════════════════════════════════════════════
// TRIGGERS — exported, called from other modules' services.
// Every function here is safe to call-and-forget (still awaited
// by the caller, but guaranteed never to throw).
// ════════════════════════════════════════════════════════════════

// ── notifyPayrollGenerated ────────────────────────────────────
// Called once per generatePayroll() batch, after insertMany.
// Recipient: the user who ran the generation.

export const notifyPayrollGenerated = async ({
  tenantId,
  outletId,
  outletName,
  generatedByUserId,
  month,
  year,
  generated,
  skipped,
}) => {
  try {
    await createNotification({
      tenantId,
      userId:  generatedByUserId,
      type:    'payroll_generated',
      title:   'Payroll generated',
      message: `Payroll for ${outletName ?? 'outlet'} (${month}/${year}) generated: ${generated} record(s) created` +
                (skipped ? `, ${skipped} skipped.` : '.'),
      relatedEntity: { entityType: 'Outlet', entityId: outletId },
    })
  } catch (err) {
    logger.error('Failed to create payroll_generated notification', { error: err.message })
  }
}

// ── notifyRiderBonusAchieved ──────────────────────────────────
// Called per-rider inside generatePayroll()'s employee loop, only
// when the rider's combined daily-tier + weekly-attendance bonus
// for the period is greater than zero.
//
// Recipient: outlet stakeholders, NOT the rider — riders are
// Employee records, not Users, and have no in-app access (see
// Phase 2 review §3). waText/waLink let staff forward the news to
// the rider's own phone manually.

export const notifyRiderBonusAchieved = async ({
  tenantId,
  outletId,
  employee,
  month,
  year,
  bonusAmount,
}) => {
  try {
    const recipientIds = await findOutletStakeholderUserIds(tenantId, outletId)
    if (recipientIds.length === 0) return

    const formattedAmount = bonusAmount.toLocaleString('id-ID')
    const text = `Halo ${employee.name}, Anda mendapatkan bonus sebesar Rp${formattedAmount} untuk periode ${month}/${year}. Selamat!`
    const { waText, waLink } = buildWhatsAppFields(employee.phone, text)

    const title   = 'Rider bonus achieved'
    const message = `${employee.name} earned a Rp${formattedAmount} bonus for ${month}/${year}.`

    await Promise.all(
      recipientIds.map((userId) =>
        createNotification({
          tenantId,
          userId,
          type:    'rider_bonus_achieved',
          title,
          message,
          relatedEntity: { entityType: 'Employee', entityId: employee._id },
          waText,
          waLink,
        })
      )
    )
  } catch (err) {
    logger.error('Failed to create rider_bonus_achieved notification', { error: err.message })
  }
}

// ── notifyBikeMaintenanceOverdue ──────────────────────────────
// Called once per OPEN/IN_REPAIR damage report on every read of
// the maintenance dashboard (bike.service.js → getMaintenanceDashboard).
//
// No scheduler exists in this codebase (approved decision) — so
// "overdue" is evaluated lazily at read time, using daysOpen
// already computed by the caller. Self-deduplicating via a
// Notification lookup on relatedEntity.entityId, so re-reading the
// dashboard never creates a second notification for the same report.

export const notifyBikeMaintenanceOverdue = async ({
  tenantId,
  outletId,
  bike,
  damageReportId,
  daysOpen,
}) => {
  try {
    if (daysOpen < BIKE_MAINTENANCE_OVERDUE_DAYS) return

    const alreadyNotified = await Notification.findOne({
      type: 'bike_maintenance_overdue',
      'relatedEntity.entityId': damageReportId,
    }).lean()
    if (alreadyNotified) return

    const recipientIds = await findOutletStakeholderUserIds(tenantId, outletId)
    if (recipientIds.length === 0) return

    const title   = 'Bike maintenance overdue'
    const message = `${bike?.name ?? 'A bike'} (${bike?.assetCode ?? '—'}) has an unresolved damage report open for ${daysOpen} day(s).`

    await Promise.all(
      recipientIds.map((userId) =>
        createNotification({
          tenantId,
          userId,
          type:    'bike_maintenance_overdue',
          title,
          message,
          relatedEntity: { entityType: 'BikeDamageReport', entityId: damageReportId },
        })
      )
    )
  } catch (err) {
    logger.error('Failed to create bike_maintenance_overdue notification', { error: err.message })
  }
}
