// ============================================================
// modules/user/user.service.js
// All User Management business logic.
//
// Responsibilities:
//   ✅ Create / read / update user accounts
//   ✅ Toggle account active status
//   ✅ Admin password reset
//   ✅ Tenant isolation via buildBaseQuery
//   ✅ Outlet ownership validation
//   ✅ Role escalation prevention
//   ❌ Does NOT handle req/res — controller territory
//   ❌ Does NOT hash passwords — uses hashPassword util
//   ❌ Does NOT return passwordHash in any response
//
// Tenant isolation strategy:
//   super_admin  → no tenantId filter
//   tenant_admin → tenantId filter
//   manager      → tenantId + outletId filter (defensive)
//   cashier      → tenantId + outletId filter (defensive)
//   viewer       → tenantId + outletId filter (defensive)
//
//   Manager/cashier/viewer currently have no user-management
//   permissions so they cannot reach these functions — but
//   buildBaseQuery scopes them correctly anyway to prevent
//   accidental data exposure if permissions ever change.
//
// Sprint 1 — User Management
// ============================================================

import mongoose from 'mongoose'
import User   from '../../models/User.model.js'
import Outlet from '../../models/Outlet.model.js'
import ApiError     from '../../utils/ApiError.js'
import hashPassword from '../../utils/hashPassword.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'

// ── Sanitize ──────────────────────────────────────────────────

/**
 * Strips passwordHash and any other sensitive internal fields
 * before returning user data to the controller.
 * passwordHash is excluded by the schema's select:false, but
 * this function acts as an explicit, documented second barrier.
 *
 * createdBy is included — it is useful audit information for admins.
 *
 * @param {Object} user - raw lean user document from DB
 * @returns {Object} safe user object
 */
const sanitizeUser = (user) => ({
  _id:       user._id,
  name:      user.name,
  email:     user.email,
  role:      user.role,
  tenantId:  user.tenantId  ?? null,
  outletId:  user.outletId  ?? null,
  isActive:  user.isActive,
  createdBy: user.createdBy ?? null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
})

// ── buildBaseQuery ────────────────────────────────────────────

/**
 * Builds the Mongoose filter object for user queries.
 *
 * super_admin : no scope — can see all users across all tenants
 * tenant_admin: tenantId scope — sees all users in their tenant
 * manager     : tenantId + outletId — defensive scoping
 * cashier     : tenantId + outletId — defensive scoping
 * viewer      : tenantId + outletId — defensive scoping
 *
 * Note: manager/cashier/viewer do not have user-management
 * permissions today. Scoping is applied defensively to ensure
 * that if permissions expand in the future, no accidental
 * cross-outlet data exposure occurs.
 *
 * @param {string|null} tenantId - from req.tenantId (set by tenantGuard)
 * @param {Object}      user     - from req.user (set by authenticate)
 * @returns {Object} Mongoose filter
 */
const buildBaseQuery = (tenantId, user) => {
  const query = {}

  if (!user || user.role === ROLES.SUPER_ADMIN) return query

  query.tenantId = new mongoose.Types.ObjectId(tenantId)

  // Outlet-scoped roles — all non-admin roles are outlet-scoped
  if (
    (user.role === ROLES.MANAGER ||
     user.role === ROLES.CASHIER  ||
     user.role === ROLES.VIEWER) &&
    user.outletId
  ) {
    query.outletId = new mongoose.Types.ObjectId(user.outletId)
  }

  return query
}

// ── validateOutletOwnership ───────────────────────────────────

/**
 * Confirms an outletId exists, is active, and belongs to tenantId.
 * Called before creating/updating a user with an outletId.
 *
 * @param {string} tenantId
 * @param {string} outletId
 * @throws {ApiError} 400 if outlet is not found or belongs to another tenant
 */
const validateOutletOwnership = async (tenantId, outletId) => {
  const outlet = await Outlet.findOne({
    _id:       new mongoose.Types.ObjectId(outletId),
    tenantId:  new mongoose.Types.ObjectId(tenantId),
    deletedAt: null,
  }).lean()

  if (!outlet) {
    throw new ApiError(400, 'Outlet not found or does not belong to this tenant')
  }
}

// ── createUser ────────────────────────────────────────────────

/**
 * Creates a new user account within the caller's tenant.
 *
 * Role escalation prevention:
 *   tenant_admin cannot create another tenant_admin.
 *   (super_admin can create any role, including tenant_admin.)
 *
 * Outlet ownership is validated before saving — an outletId
 * from another tenant is rejected with 400.
 *
 * @param {string} tenantId  - from req.tenantId
 * @param {Object} caller    - req.user (the authenticated user creating the account)
 * @param {Object} data      - validated req.body
 * @returns {Promise<Object>} sanitized created user
 * @throws {ApiError} 403 on escalation attempt, 400 on bad outlet, 409 on duplicate email
 */
export const createUser = async (tenantId, caller, data) => {
  const { name, email, password, role, outletId } = data

  // ── Role escalation guard ──────────────────────────────────
  // tenant_admin can create manager, cashier, viewer — but not
  // another tenant_admin. super_admin has no restriction.
  if (
    caller.role === ROLES.TENANT_ADMIN &&
    role === ROLES.TENANT_ADMIN
  ) {
    throw new ApiError(403, 'tenant_admin cannot create another tenant_admin account')
  }

  // ── Outlet ownership validation ────────────────────────────
  if (outletId) {
    await validateOutletOwnership(tenantId, outletId)
  }

  // ── Hash password ──────────────────────────────────────────
  const hashed = await hashPassword(password)

  // ── Create document ────────────────────────────────────────
  try {
    const user = await User.create({
      tenantId:     new mongoose.Types.ObjectId(tenantId),
      outletId:     outletId ? new mongoose.Types.ObjectId(outletId) : null,
      name:         name.trim(),
      email:        email.toLowerCase().trim(),
      passwordHash: hashed,
      role,
      isActive:     true,
      createdBy:    new mongoose.Types.ObjectId(caller.userId),
    })

    return sanitizeUser(user.toObject())
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'A user with this email already exists in this tenant')
    }
    throw err
  }
}

// ── getUsers ──────────────────────────────────────────────────

/**
 * Paginated list of users in scope.
 * Supports filtering by: role, isActive, search (name/email).
 *
 * @param {string|null} tenantId
 * @param {Object}      caller    - req.user
 * @param {Object}      queryParams - req.query
 * @returns {Promise<{ users: Object[], pagination: Object }>}
 */
export const getUsers = async (tenantId, caller, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = buildBaseQuery(tenantId, caller)

  // Optional filters
  if (queryParams.role) {
    filter.role = queryParams.role
  }

  if (queryParams.isActive !== undefined) {
    filter.isActive = queryParams.isActive === 'true'
  }

  if (queryParams.outletId) {
    if (mongoose.Types.ObjectId.isValid(queryParams.outletId)) {
      filter.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
    }
  }

  if (queryParams.search) {
    const pattern = queryParams.search.trim()
    filter.$or = [
      { name:  { $regex: pattern, $options: 'i' } },
      { email: { $regex: pattern, $options: 'i' } },
    ]
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ])

  return {
    users:      users.map(sanitizeUser),
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getUserById ───────────────────────────────────────────────

/**
 * Fetches a single user by ID, scoped by the caller's tenant/outlet.
 * Returns 404 (not 403) when the target does not exist within scope —
 * avoids leaking whether a user ID exists in another tenant.
 *
 * @param {string|null} tenantId
 * @param {Object}      caller
 * @param {string}      userId
 * @returns {Promise<Object>} sanitized user
 * @throws {ApiError} 404 if not found within scope
 */
export const getUserById = async (tenantId, caller, userId) => {
  const filter = buildBaseQuery(tenantId, caller)
  filter._id   = new mongoose.Types.ObjectId(userId)

  const user = await User.findOne(filter).lean()

  if (!user) throw new ApiError(404, 'User not found')

  return sanitizeUser(user)
}

// ── updateUser ────────────────────────────────────────────────

/**
 * Updates mutable fields: name, email, outletId.
 * role and password are immutable via this endpoint.
 *
 * If outletId is being changed, the new outlet is validated
 * against the caller's tenant.
 *
 * @param {string|null} tenantId
 * @param {Object}      caller
 * @param {string}      userId
 * @param {Object}      data - validated req.body
 * @returns {Promise<Object>} sanitized updated user
 * @throws {ApiError} 404 if not found, 409 on duplicate email, 400 on bad outlet
 */
export const updateUser = async (tenantId, caller, userId, data) => {
  const { name, email, outletId } = data

  // Validate new outletId if provided and not being cleared
  if (outletId !== undefined && outletId !== null) {
    await validateOutletOwnership(tenantId, outletId)
  }

  const updateData = {}
  if (name     !== undefined) updateData.name     = name.trim()
  if (email    !== undefined) updateData.email    = email.toLowerCase().trim()
  if (outletId !== undefined) updateData.outletId = outletId
    ? new mongoose.Types.ObjectId(outletId)
    : null

  const filter = buildBaseQuery(tenantId, caller)
  filter._id   = new mongoose.Types.ObjectId(userId)

  let user
  try {
    user = await User.findOneAndUpdate(
      filter,
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean()
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'A user with this email already exists in this tenant')
    }
    throw err
  }

  if (!user) throw new ApiError(404, 'User not found')

  return sanitizeUser(user)
}

// ── toggleUserActive ──────────────────────────────────────────

/**
 * Flips the isActive status of a user account.
 * Deactivated users cannot log in. Their existing access token
 * remains valid until the 15-minute TTL, but GET /auth/me
 * rejects them immediately via the isActive check there.
 *
 * Prevents self-deactivation — an admin cannot lock themselves out.
 *
 * @param {string|null} tenantId
 * @param {Object}      caller
 * @param {string}      userId
 * @returns {Promise<Object>} sanitized updated user
 * @throws {ApiError} 404, 400 on self-deactivation attempt
 */
export const toggleUserActive = async (tenantId, caller, userId) => {
  // Prevent self-deactivation
  if (caller.userId === userId) {
    throw new ApiError(400, 'You cannot deactivate your own account')
  }

  const filter = buildBaseQuery(tenantId, caller)
  filter._id   = new mongoose.Types.ObjectId(userId)

  const user = await User.findOne(filter)

  if (!user) throw new ApiError(404, 'User not found')

  user.isActive = !user.isActive
  await user.save()

  return sanitizeUser(user.toObject())
}

// ── resetUserPassword ─────────────────────────────────────────

/**
 * Admin action — sets a new password for a target user.
 * Does not require the current password.
 * The caller (tenant_admin or super_admin) communicates the
 * new password to the user out-of-band.
 *
 * @param {string|null} tenantId
 * @param {Object}      caller
 * @param {string}      userId
 * @param {string}      newPassword - already validated (min 8 chars)
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if not found within scope
 */
export const resetUserPassword = async (tenantId, caller, userId, newPassword) => {
  const filter = buildBaseQuery(tenantId, caller)
  filter._id   = new mongoose.Types.ObjectId(userId)

  // Must use findOne (not findById) to respect tenant scope
  const user = await User.findOne(filter).select('+passwordHash')

  if (!user) throw new ApiError(404, 'User not found')

  user.passwordHash = await hashPassword(newPassword)
  await user.save()

  // No return value — 200 with null data is sent by controller
}