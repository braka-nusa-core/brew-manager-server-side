// ============================================================
// modules/tenant/tenant.controller.js
// HTTP request/response layer for tenant endpoints.
// Zero business logic — all logic in tenant.service.js.
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import {
  validateBootstrap,
  validateCreateTenant,
  validateUpdateTenant,
} from './tenant.validation.js'
import {
  bootstrapTenant,
  getTenants,
  getTenantById,
  createTenant,
  updateTenant,
  softDeleteTenant,
} from './tenant.service.js'

// ── POST /api/v1/tenants/bootstrap ────────────────────────────
// Public endpoint — no authentication required.
// Creates: Tenant + TenantAdmin User + First Outlet atomically.

export const bootstrap = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateBootstrap(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const result = await bootstrapTenant(req.body)

  return res.status(201).json(
    successResponse(
      'Tenant bootstrapped successfully. Save your admin credentials.',
      result
    )
  )
})

// ── GET /api/v1/tenants ───────────────────────────────────────
// super_admin only.

export const getAll = asyncHandler(async (req, res) => {
  const { tenants, pagination } = await getTenants(req.query)

  return res.status(200).json({
    success: true,
    message: 'Tenants retrieved successfully',
    data:    tenants,
    pagination,
  })
})

// ── GET /api/v1/tenants/:tenantId ─────────────────────────────
// super_admin only.

export const getOne = asyncHandler(async (req, res) => {
  const tenant = await getTenantById(req.params.tenantId)

  return res.status(200).json(successResponse('Tenant retrieved successfully', tenant))
})

// ── POST /api/v1/tenants ──────────────────────────────────────
// super_admin only. Direct tenant creation without bootstrap.

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreateTenant(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const tenant = await createTenant(req.body, req.user.userId)

  return res.status(201).json(successResponse('Tenant created successfully', tenant))
})

// ── PATCH /api/v1/tenants/:tenantId ──────────────────────────
// super_admin only.

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdateTenant(req.body)

  if (!isValid) {
    return res.status(400).json(errorResponse('Validation failed', 400, errors))
  }

  const tenant = await updateTenant(req.params.tenantId, req.body)

  return res.status(200).json(successResponse('Tenant updated successfully', tenant))
})

// ── DELETE /api/v1/tenants/:tenantId ─────────────────────────
// super_admin only. Soft delete.

export const remove = asyncHandler(async (req, res) => {
  await softDeleteTenant(req.params.tenantId)

  return res.status(204).send()
})