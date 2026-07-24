// ============================================================
// modules/outlet/outlet.service.js
// All outlet business logic.
// Every function receives tenantId from the middleware context —
// never from request body.
// ============================================================

import mongoose from 'mongoose'
import Outlet   from '../../models/Outlet.model.js'
import ApiError from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { checkPlanLimit } from '../../utils/checkPlanLimit.js'
import { ROLES } from '../../constants/permissions.js'

// ── Outlet code generator ─────────────────────────────────────

/**
 * Generates a short unique uppercase code for an outlet within a tenant.
 * "Jakarta Selatan" → "JKTS"
 * On collision adds a numeric suffix: "JKT1", "JKT2"…
 */
const generateOutletCode = async (tenantId, outletName, providedCode) => {
  if (providedCode) return providedCode.trim().toUpperCase()

  const base = outletName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 4) || 'OUT'

  const existing = await Outlet.findOne({ tenantId, code: base }).lean()
  if (!existing) return base

  for (let i = 1; i <= 99; i++) {
    const candidate = `${base.slice(0, 3)}${i}`
    const col = await Outlet.findOne({ tenantId, code: candidate }).lean()
    if (!col) return candidate
  }

  return `OUT${Date.now().toString(36).slice(-4).toUpperCase()}`
}

// ── Base query builder ────────────────────────────────────────

/**
 * Builds the base Mongoose filter for outlet queries.
 * super_admin: no tenantId scope
 * tenant_admin: tenantId scope only
 * manager/cashier: tenantId + their own outletId
 *
 * Note: manager/cashier don't manage outlets — they only VIEW their own.
 * Route-level authorize() already restricts MANAGE_OUTLETS to admin roles.
 * This builder is for READ queries (getOutlets, getOutletById).
 */
const buildBaseQuery = (tenantId, user) => {
  const query = { deletedAt: null }

  if (!user || user.role === ROLES.SUPER_ADMIN) return query

  query.tenantId = new mongoose.Types.ObjectId(tenantId)

  // Manager/cashier can only see their own outlet
  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    user.outletId
  ) {
    query._id = new mongoose.Types.ObjectId(user.outletId)
  }

  return query
}

// ── createOutlet ──────────────────────────────────────────────

/**
 * Creates a new outlet scoped to the given tenant.
 * tenantId always comes from middleware context (req.tenantId).
 *
 * @param {string}  tenantId - from req.tenantId
 * @param {Object}  data     - validated req.body
 * @returns {Promise<Object>} created outlet
 */
export const createOutlet = async (tenantId, data) => {
  // Sprint 2: enforce plan outlet limit before creating
  await checkPlanLimit(tenantId, 'outlets')

  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const outletCode = await generateOutletCode(tenantOid, data.name, data.code)

  try {
    const outlet = await Outlet.create({
      tenantId: tenantOid,
      name:     data.name.trim(),
      code:     outletCode,
      address:  data.address?.trim() ?? null,
      phone:    data.phone?.trim()   ?? null,
      isActive: true,
    })

    return outlet.toObject()
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'An outlet with this code already exists in this tenant')
    }
    throw err
  }
}

// ── getOutlets ────────────────────────────────────────────────

/**
 * Paginated list of outlets in scope.
 * Filters: isActive, search (name/code), page, limit.
 *
 * @param {string|null} tenantId
 * @param {Object}      user - req.user
 * @param {Object}      queryParams - req.query
 */
export const getOutlets = async (tenantId, user, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = buildBaseQuery(tenantId, user)

  if (queryParams.isActive !== undefined) {
    filter.isActive = queryParams.isActive === 'true'
  }

  if (queryParams.search) {
    filter.$or = [
      { name: { $regex: queryParams.search.trim(), $options: 'i' } },
      { code: { $regex: queryParams.search.trim(), $options: 'i' } },
    ]
  }

  const [outlets, total] = await Promise.all([
    Outlet.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Outlet.countDocuments(filter),
  ])

  return {
    outlets,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getOutletById ─────────────────────────────────────────────

export const getOutletById = async (tenantId, user, outletId) => {
  const filter = buildBaseQuery(tenantId, user)
  filter._id   = new mongoose.Types.ObjectId(outletId)

  // If manager/cashier queried a specific outlet ID, it must be their own
  // (buildBaseQuery already sets _id to their outletId for scoped roles —
  // override only if they are admin roles)
  if (
    (user?.role === ROLES.MANAGER || user?.role === ROLES.CASHIER) &&
    user.outletId &&
    user.outletId.toString() !== outletId
  ) {
    throw new ApiError(403, 'Access denied to this outlet')
  }

  const outlet = await Outlet.findOne(filter).lean()

  if (!outlet) throw new ApiError(404, 'Outlet not found')

  return outlet
}

// ── updateOutlet ──────────────────────────────────────────────

/**
 * Updates mutable outlet fields.
 * tenantId is immutable (validated in validation layer).
 * code uniqueness re-checked if code is being changed.
 */
export const updateOutlet = async (tenantId, outletId, data) => {
  const tenantOid = new mongoose.Types.ObjectId(tenantId)
  const outletOid = new mongoose.Types.ObjectId(outletId)

  // If code is being changed, verify no collision
  if (data.code) {
    const collision = await Outlet.findOne({
      tenantId: tenantOid,
      code:     data.code.trim().toUpperCase(),
      _id:      { $ne: outletOid },
      deletedAt: null,
    }).lean()

    if (collision) {
      throw new ApiError(409, 'An outlet with this code already exists in this tenant')
    }
  }

  const updateData = {}
  if (data.name     !== undefined) updateData.name     = data.name.trim()
  if (data.code     !== undefined) updateData.code     = data.code.trim().toUpperCase()
  if (data.address  !== undefined) updateData.address  = data.address?.trim() ?? null
  if (data.phone    !== undefined) updateData.phone    = data.phone?.trim()   ?? null
  if (data.isActive !== undefined) updateData.isActive = data.isActive

  // ── Payroll configuration (Phase 1 fields) ────────────────
  // Validated in outlet.validation.js — copied through here as-is,
  // matching the same "only if provided" pattern as the fields above.
  if (data.payrollType           !== undefined) updateData.payrollType           = data.payrollType
  if (data.commissionPercentage  !== undefined) updateData.commissionPercentage  = data.commissionPercentage
  if (data.mealAllowancePerDay   !== undefined) updateData.mealAllowancePerDay   = data.mealAllowancePerDay
  if (data.weeklyAttendanceBonus !== undefined) updateData.weeklyAttendanceBonus = data.weeklyAttendanceBonus
  if (data.bonusRules            !== undefined) updateData.bonusRules            = data.bonusRules

  const outlet = await Outlet.findOneAndUpdate(
    { _id: outletOid, tenantId: tenantOid, deletedAt: null },
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!outlet) throw new ApiError(404, 'Outlet not found')

  return outlet
}

// ── softDeleteOutlet ──────────────────────────────────────────

/**
 * Soft-deletes an outlet: sets deletedAt + isActive = false.
 * The outlet's employees and operational data are preserved.
 */
export const softDeleteOutlet = async (tenantId, outletId) => {
  const outlet = await Outlet.findOneAndUpdate(
    {
      _id:      new mongoose.Types.ObjectId(outletId),
      tenantId: new mongoose.Types.ObjectId(tenantId),
      deletedAt: null,
    },
    { $set: { isActive: false, deletedAt: new Date() } },
    { new: true }
  ).lean()

  if (!outlet) throw new ApiError(404, 'Outlet not found')
}

// ── toggleOutletActive ────────────────────────────────────────

/**
 * Flips the isActive status of an outlet.
 * Cannot activate a soft-deleted outlet.
 */
export const toggleOutletActive = async (tenantId, outletId) => {
  const outlet = await Outlet.findOne({
    _id:      new mongoose.Types.ObjectId(outletId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
    deletedAt: null,
  })

  if (!outlet) throw new ApiError(404, 'Outlet not found')

  outlet.isActive = !outlet.isActive
  await outlet.save()

  return outlet.toObject()
}