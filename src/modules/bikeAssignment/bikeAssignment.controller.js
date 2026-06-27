// ============================================================
// modules/bikeAssignment/bikeAssignment.controller.js
// HTTP layer for bike assignment endpoints. Zero business logic.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateAssignment } from './bikeAssignment.validation.js'
import {
  createAssignment,
  getAssignments,
  getActiveAssignments,
  endAssignment,
} from './bikeAssignment.service.js'

// ── POST /api/v1/bike-assignments ─────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateAssignment(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const assignment = await createAssignment(req.tenantId, req.body)

  return res.status(201).json(successResponse('Bike assignment created successfully', assignment))
})

// ── GET /api/v1/bike-assignments ──────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { assignments, pagination } = await getAssignments(req.tenantId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Bike assignments retrieved successfully',
    data:       assignments,
    pagination,
  })
})

// ── GET /api/v1/bike-assignments/active ───────────────────────
// MUST be registered before /:assignmentId in routes.

export const getActive = asyncHandler(async (req, res) => {
  const data = await getActiveAssignments(req.tenantId)

  return res.status(200).json(successResponse('Active assignments retrieved successfully', data))
})

// ── PATCH /api/v1/bike-assignments/:assignmentId/end ──────────

export const end = asyncHandler(async (req, res) => {
  const assignment = await endAssignment(req.tenantId, req.params.assignmentId)

  return res.status(200).json(successResponse('Bike assignment ended successfully', assignment))
})