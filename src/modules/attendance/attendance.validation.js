// ============================================================
// modules/attendance/attendance.validation.js
// Pure validation functions for all attendance operations.
// No Express dependency — independently testable.
//
// Three validators:
//   validateCreateAttendance  → single record
//   validateBulkAttendance    → bulk date + attendances array
//   validateUpdateAttendance  → partial update (status/notes only)
//
// Bulk shape (aligned to spec v1.1):
// {
//   date: "2026-05-18",
//   attendances: [
//     { employeeId: "...", status: "present", notes: "" }
//   ]
// }
// outletId is NOT in the bulk body — it is derived from the
// Employee record in the service layer.
// ============================================================

import { ATTENDANCE_STATUSES } from '../../models/Attendance.model.js'

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

// ── validateCreateAttendance ──────────────────────────────────

/**
 * Validates a single attendance creation request.
 * outletId is required here because the single-record endpoint
 * accepts it explicitly — the service still validates the employee.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateAttendance = (body) => {
  const errors = []
  const { employeeId, date, status, notes } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (!status) {
    errors.push('status is required')
  } else if (!ATTENDANCE_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`)
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateBulkAttendance ────────────────────────────────────

/**
 * Validates a bulk attendance submission.
 *
 * Body shape (spec v1.1):
 * {
 *   date: "2026-05-18",
 *   attendances: [
 *     { employeeId: "...", status: "present", notes: "" },
 *     { employeeId: "...", status: "late",    notes: "15 mins late" }
 *   ]
 * }
 *
 * outletId is intentionally absent from the body.
 * The service derives outletId from each Employee record.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateBulkAttendance = (body) => {
  const errors = []
  const { date, attendances } = body

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (!attendances) {
    errors.push('attendances array is required')
  } else if (!Array.isArray(attendances)) {
    errors.push('attendances must be an array')
  } else if (attendances.length === 0) {
    errors.push('attendances array must not be empty')
  } else {
    attendances.forEach((entry, index) => {
      const prefix = `attendances[${index}]`

      if (!entry.employeeId) {
        errors.push(`${prefix}.employeeId is required`)
      } else if (!isValidObjectId(entry.employeeId)) {
        errors.push(`${prefix}.employeeId must be a valid ObjectId`)
      }

      if (!entry.status) {
        errors.push(`${prefix}.status is required`)
      } else if (!ATTENDANCE_STATUSES.includes(entry.status)) {
        errors.push(
          `${prefix}.status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`
        )
      }

      if (
        entry.notes !== undefined &&
        entry.notes !== null &&
        typeof entry.notes !== 'string'
      ) {
        errors.push(`${prefix}.notes must be a string`)
      }
    })

    // Guard against duplicate employeeIds in the same bulk request
    const ids = attendances.map((e) => e.employeeId).filter(Boolean)
    const uniqueIds = new Set(ids)
    if (uniqueIds.size !== ids.length) {
      errors.push('attendances array contains duplicate employeeId entries')
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateAttendance ──────────────────────────────────

/**
 * Validates an attendance update request.
 * Only status and notes are mutable.
 * All other fields are immutable after creation.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateAttendance = (body) => {
  const errors = []
  const { status, notes, employeeId, date, outletId, tenantId } = body

  // Guard immutable fields
  if (employeeId !== undefined) errors.push('employeeId cannot be changed')
  if (date       !== undefined) errors.push('date cannot be changed')
  if (outletId   !== undefined) errors.push('outletId cannot be changed')
  if (tenantId   !== undefined) errors.push('tenantId cannot be changed')

  // At least one mutable field must be present
  if (status === undefined && notes === undefined) {
    errors.push('At least one of status or notes must be provided')
  }

  if (status !== undefined && !ATTENDANCE_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`)
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  return { isValid: errors.length === 0, errors }
}
