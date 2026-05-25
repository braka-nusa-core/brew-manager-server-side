// ============================================================
// modules/attendance/attendance.controller.js
// HTTP request/response layer for the attendance module.
// Zero business logic — all logic is in attendance.service.js.
//
// Fix (v2):
//   bulkCreate line 70: result.duplicates was undefined → crash.
//   Root cause: service returns a shape that doesn't match what
//   controller expected. Added nullish-coalescing normalization
//   so controller works with any reasonable service return shape.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateCreateAttendance,
  validateBulkAttendance,
  validateUpdateAttendance,
} from './attendance.validation.js'
import {
  createAttendance,
  bulkCreateAttendance,
  getAttendances,
  getAttendanceById,
  updateAttendance,
  deleteAttendance,
} from './attendance.service.js'

// ── POST /api/v1/attendance ───────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateAttendance(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const attendance = await createAttendance({
    tenantId: req.tenantId,
    user:     req.user,
    data:     req.body,
  })

  return res
    .status(201)
    .json(successResponse('Attendance recorded successfully', attendance))
})

// ── POST /api/v1/attendance/bulk ──────────────────────────────

export const bulkCreate = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateBulkAttendance(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const result = await bulkCreateAttendance({
    tenantId: req.tenantId,
    user:     req.user,
    data:     req.body,
  })

  // ── Normalize result shape ──────────────────────────────────
  // The service may return different field names. Guard against
  // undefined with nullish coalescing so .length never throws.
  //
  //   Service shape A (original spec):
  //     { inserted: number, duplicates: [], errors: [] }
  //   Service shape B (alternate):
  //     { successCount: number, failedItems: [], failedCount: number }
  //   Service shape C (minimal):
  //     { inserted: number }   ← duplicates/errors omitted when empty
  const inserted   = result.inserted     ?? result.successCount ?? 0
  const duplicates = result.duplicates   ?? []
  const errs       = result.errors       ?? result.failedItems  ?? []

  const hasPartialFailure = duplicates.length > 0 || errs.length > 0
  const statusCode        = hasPartialFailure ? 207 : 201

  const message = hasPartialFailure
    ? `Bulk attendance partially recorded: ${inserted} inserted, ${duplicates.length + errs.length} skipped`
    : `Bulk attendance recorded successfully: ${inserted} records inserted`

  // Return a normalized shape that covers all field names the
  // frontend BulkResultSummary handler looks for.
  return res.status(statusCode).json(successResponse(message, {
    inserted,
    successCount: inserted,
    duplicates,
    errors:       errs,
    failedItems:  errs,
    failedCount:  duplicates.length + errs.length,
  }))
})

// ── GET /api/v1/attendance ────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { attendances, pagination } = await getAttendances({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json({
    success: true,
    message: 'Attendance records retrieved successfully',
    data:    attendances,
    pagination,
  })
})

// ── GET /api/v1/attendance/:attendanceId ──────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const attendance = await getAttendanceById({
    tenantId:     req.tenantId,
    user:         req.user,
    attendanceId: req.params.attendanceId,
  })

  return res
    .status(200)
    .json(successResponse('Attendance record retrieved successfully', attendance))
})

// ── PATCH /api/v1/attendance/:attendanceId ────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateAttendance(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const attendance = await updateAttendance({
    tenantId:     req.tenantId,
    user:         req.user,
    attendanceId: req.params.attendanceId,
    data:         req.body,
  })

  return res
    .status(200)
    .json(successResponse('Attendance record updated successfully', attendance))
})

// ── DELETE /api/v1/attendance/:attendanceId ───────────────────
// Hard delete — incorrect records are removed and re-submitted.
// Unique index prevents accidental duplicate re-entry.

export const remove = asyncHandler(async (req, res) => {
  await deleteAttendance({
    tenantId:     req.tenantId,
    user:         req.user,
    attendanceId: req.params.attendanceId,
  })

  return res.status(204).send()
})