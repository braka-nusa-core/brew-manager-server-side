// ============================================================
// modules/bikeMaintenance/bikeMaintenance.controller.js
// HTTP layer for damage report and repair record endpoints.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateCreateDamageReport,
  validateDamageReportStatus,
  validateCreateRepairRecord,
  validateUpdateRepairRecord,
} from './bikeMaintenance.validation.js'
import {
  createDamageReport,
  getDamageReports,
  updateDamageReportStatus,
  createRepairRecord,
  getRepairRecords,
  updateRepairRecord,
} from './bikeMaintenance.service.js'

// ── POST /api/v1/bike-damage-reports ──────────────────────────

export const createDamage = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateDamageReport(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const report = await createDamageReport(req.tenantId, req.user.userId, req.body)

  return res.status(201).json(successResponse('Damage report created successfully', report))
})

// ── GET /api/v1/bike-damage-reports ───────────────────────────

export const getAllDamage = asyncHandler(async (req, res) => {
  const { reports, pagination } = await getDamageReports(req.tenantId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Damage reports retrieved successfully',
    data:       reports,
    pagination,
  })
})

// ── PATCH /api/v1/bike-damage-reports/:id/status ──────────────

export const updateDamageStatus = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateDamageReportStatus(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const report = await updateDamageReportStatus(req.tenantId, req.params.id, req.body.status)

  return res.status(200).json(successResponse('Damage report status updated successfully', report))
})

// ── POST /api/v1/bike-repair-records ───────────────────────────

export const createRepair = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateRepairRecord(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const record = await createRepairRecord(req.tenantId, req.body)

  return res.status(201).json(successResponse('Repair record created successfully', record))
})

// ── GET /api/v1/bike-repair-records ────────────────────────────

export const getAllRepair = asyncHandler(async (req, res) => {
  const { records, pagination } = await getRepairRecords(req.tenantId, req.query)

  return res.status(200).json({
    success:    true,
    message:    'Repair records retrieved successfully',
    data:       records,
    pagination,
  })
})

// ── PATCH /api/v1/bike-repair-records/:id ──────────────────────

export const updateRepair = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateRepairRecord(req.body)
  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const record = await updateRepairRecord(req.tenantId, req.params.id, req.body)

  return res.status(200).json(successResponse('Repair record updated successfully', record))
})