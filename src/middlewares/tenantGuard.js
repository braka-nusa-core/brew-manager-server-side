// ============================================================
// middlewares/tenantGuard.js
// Enforces tenant isolation and attaches tenantId/outletId
// to the request context for controllers and services.
//
// v1.1 upgrade: now validates tenant exists + isActive in DB.
// The Tenant model now exists, so this check is safe to add.
//
// Responsibilities:
//   ✅ Read req.user (set by authenticate.js)
//   ✅ Attach req.tenantId from token — never from body
//   ✅ Attach req.outletId for outlet-scoped roles
//   ✅ Validate tenant exists and isActive (DB check)
//   ✅ super_admin bypasses tenant/outlet scope
//   ✅ tenant_admin: scoped to tenantId only
//   ✅ manager/cashier: scoped to tenantId + outletId
//   ❌ Does NOT verify JWT (authenticate.js)
//   ❌ Does NOT check route-level permissions (authorize.js)
// ============================================================

import mongoose      from 'mongoose'
import Tenant        from '../models/Tenant.model.js'
import { ROLES }     from '../constants/permissions.js'
import { errorResponse } from '../utils/apiResponse.js'

/**
 * tenantGuard middleware
 *
 * Execution order: AFTER authenticate.js, BEFORE authorize.js.
 *
 * After this middleware:
 *   req.tenantId  — string | null  (null for super_admin)
 *   req.outletId  — string | null  (null for tenant_admin and above)
 *   req.tenant    — Tenant document | null (for DB-level checks downstream)
 */
const tenantGuard = async (req, res, next) => {
  try {
    const { userId, tenantId, outletId, role } = req.user

    if (!userId || !role) {
      return res
        .status(401)
        .json(errorResponse('Unauthorized — user context is missing', 401))
    }

    // ── super_admin: no tenant scope ──────────────────────────
    // Operates across all tenants. No DB validation needed.
    if (role === ROLES.SUPER_ADMIN) {
      req.tenantId = null
      req.outletId = null
      req.tenant   = null
      return next()
    }

    // ── All other roles: must have tenantId in token ──────────
    if (!tenantId) {
      return res
        .status(403)
        .json(errorResponse('Forbidden — tenant context is missing from token', 403))
    }

    // ── DB validation: confirm tenant exists and is active ────
    // This prevents requests from deactivated tenants from proceeding.
    const tenant = await Tenant.findOne({
      _id:       new mongoose.Types.ObjectId(tenantId),
      isActive:  true,
      deletedAt: null,
    }).lean()

    if (!tenant) {
      return res
        .status(403)
        .json(errorResponse('Forbidden — tenant is inactive or does not exist', 403))
    }

    // ── tenant_admin: all outlets within tenant ───────────────
    if (role === ROLES.TENANT_ADMIN) {
      req.tenantId = tenantId
      req.outletId = null
      req.tenant   = tenant
      return next()
    }

    // ── manager / cashier: must also have outletId ────────────
    if (!outletId) {
      return res
        .status(403)
        .json(errorResponse('Forbidden — outlet context is missing for this role', 403))
    }

    req.tenantId = tenantId
    req.outletId = outletId
    req.tenant   = tenant

    next()
  } catch (err) {
    next(err)
  }
}

export default tenantGuard