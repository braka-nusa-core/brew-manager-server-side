// ============================================================
// modules/employee/employee.controller.js
// HTTP request/response handling for the employee module.
// Zero business logic — all logic is in employee.service.js.
//
// Responsibilities:
//   ✅ Parse req.body and req.params
//   ✅ Call validation before service
//   ✅ Call service with tenantId from req.tenantId (NOT req.body)
//   ✅ Return standardized responses
//   ❌ No DB access
//   ❌ No business logic
//   ❌ No direct model imports
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreateEmployee, validateUpdateEmployee } from './employee.validation.js'
import {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  toggleEmployeeActive,
  softDeleteEmployee,
} from './employee.service.js'

// ── POST /api/v1/employees ────────────────────────────────────

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateEmployee(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const employee = await createEmployee({
    tenantId: req.tenantId,
    user:     req.user,
    data:     req.body,
  })

  return res
    .status(201)
    .json(successResponse('Employee created successfully', employee))
})

// ── GET /api/v1/employees ─────────────────────────────────────

export const getAll = asyncHandler(async (req, res) => {
  const { employees, pagination } = await getEmployees({
    tenantId:    req.tenantId,
    user:        req.user,
    queryParams: req.query,
  })

  return res.status(200).json({
    success: true,
    message: 'Employees retrieved successfully',
    data:    employees,
    pagination,
  })
})

// ── GET /api/v1/employees/:employeeId ─────────────────────────

export const getOne = asyncHandler(async (req, res) => {
  const employee = await getEmployeeById({
    tenantId:   req.tenantId,
    user:       req.user,
    employeeId: req.params.employeeId,
  })

  return res
    .status(200)
    .json(successResponse('Employee retrieved successfully', employee))
})

// ── PATCH /api/v1/employees/:employeeId ───────────────────────

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateEmployee(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const employee = await updateEmployee({
    tenantId:   req.tenantId,
    user:       req.user,
    employeeId: req.params.employeeId,
    data:       req.body,
  })

  return res
    .status(200)
    .json(successResponse('Employee updated successfully', employee))
})

// ── PATCH /api/v1/employees/:employeeId/toggle-active ─────────

export const toggleActive = asyncHandler(async (req, res) => {
  const employee = await toggleEmployeeActive({
    tenantId:   req.tenantId,
    user:       req.user,
    employeeId: req.params.employeeId,
  })

  const message = employee.isActive
    ? 'Employee activated successfully'
    : 'Employee deactivated successfully'

  return res.status(200).json(successResponse(message, employee))
})

// ── DELETE /api/v1/employees/:employeeId ──────────────────────
// Soft delete only. Returns 204 No Content on success.

export const remove = asyncHandler(async (req, res) => {
  await softDeleteEmployee({
    tenantId:   req.tenantId,
    user:       req.user,
    employeeId: req.params.employeeId,
  })

  return res.status(204).send()
})
