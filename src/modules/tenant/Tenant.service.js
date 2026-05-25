// ============================================================
// modules/tenant/tenant.service.js
// All tenant business logic.
//
// Key flows:
//   bootstrapTenant() — public flow, no auth required:
//     1. Generate/validate slug
//     2. Create Tenant document
//     3. Create TenantAdmin User (passwordHash via bcrypt)
//     4. Create first Outlet
//     5. On any failure, roll back created docs (compensating deletes)
//     6. Return { tenant, adminUser (sanitized), outlet }
//
//   All other functions — super_admin only.
// ============================================================

import mongoose  from 'mongoose'
import Tenant    from '../../models/Tenant.model.js'
import Outlet    from '../../models/Outlet.model.js'
import User      from '../../models/User.model.js'
import ApiError  from '../../utils/ApiError.js'
import hashPassword from '../../utils/hashPassword.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── Slug helpers ──────────────────────────────────────────────

/**
 * Converts a string to a URL-safe slug.
 * "Braka Nusa Coffee" → "braka-nusa-coffee"
 */
const toSlug = (str) =>
  str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')   // remove non-alphanumeric except spaces/hyphens
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .slice(0, 55)                    // leave room for suffix

/**
 * Generates a unique slug from a name.
 * If base slug is taken, appends a random 4-char suffix.
 */
const generateUniqueSlug = async (name, providedSlug) => {
  const base = providedSlug ? providedSlug.trim() : toSlug(name)

  // Check if base slug is available
  const existing = await Tenant.findOne({ slug: base }).lean()
  if (!existing) return base

  // Collision — append random hex suffix
  let attempts = 0
  while (attempts < 5) {
    const suffix = Math.random().toString(36).slice(2, 6)
    const candidate = `${base}-${suffix}`
    const collision = await Tenant.findOne({ slug: candidate }).lean()
    if (!collision) return candidate
    attempts++
  }

  throw new ApiError(500, 'Could not generate a unique slug. Please provide one manually.')
}

// ── Outlet code helper ────────────────────────────────────────

/**
 * Generates a short uppercase outlet code from the outlet name.
 * "Jakarta Selatan" → "JKTS"
 * Ensures uniqueness within the tenant.
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

  // Collision — append number
  for (let i = 1; i <= 99; i++) {
    const candidate = `${base.slice(0, 3)}${i}`
    const col = await Outlet.findOne({ tenantId, code: candidate }).lean()
    if (!col) return candidate
  }

  return `OUT${Date.now().toString(36).slice(-4).toUpperCase()}`
}

// ── bootstrapTenant ───────────────────────────────────────────

/**
 * Public bootstrap flow — creates everything needed to start using BrewManager.
 *
 * Input shape:
 * {
 *   tenant:    { name, slug?, plan? }
 *   adminUser: { name, email, password }
 *   outlet:    { name, code?, address?, phone? }
 * }
 *
 * Returns { tenant, adminUser, outlet } — sanitized (no passwordHash).
 *
 * Rollback strategy: if outlet creation fails after tenant/user are created,
 * we delete the created documents. No MongoDB transactions needed for MVP
 * (transactions require replica set). Manual compensating deletes are safe here
 * because failure at this stage means nothing was ever used.
 *
 * @param {Object} data - validated request body
 * @returns {Promise<{ tenant, adminUser, outlet }>}
 */
export const bootstrapTenant = async (data) => {
  let createdTenant = null
  let createdUser = null
  let createdOutlet = null

  const {
    tenant: tenantData,
    adminUser: userData,
    outlet: outletData,
  } = data

  try {
    // ── 1. Generate unique tenant slug ─────────────────────
    const slug = await generateUniqueSlug(
      tenantData.name,
      tenantData.slug
    )

    // ── 2. Create Tenant ───────────────────────────────────
    createdTenant = await Tenant.create({
      name: tenantData.name,
      slug,
      plan: tenantData.plan || 'starter',
      isActive: true,
    })

    // ── 3. Create Tenant Admin User ────────────────────────
    const passwordHash = await hashPassword(userData.password)

    createdUser = await User.create({
      tenantId: createdTenant._id,
      outletId: null,

      name: userData.name,
      email: userData.email,

      passwordHash,

      role: 'tenant_admin',
    })

    // ── 4. Create First Outlet ─────────────────────────────
    const outletCode = await generateOutletCode(
      createdTenant._id,
      outletData.name,
      outletData.code
    )

    createdOutlet = await Outlet.create({
      tenantId: createdTenant._id,

      name: outletData.name,
      code: outletCode,

      address: outletData.address || null,
      phone: outletData.phone || null,

      isActive: true,
    })

    // ── 5. Sanitize user response ──────────────────────────
    const sanitizedUser = {
      _id: createdUser._id,
      tenantId: createdUser.tenantId,
      outletId: createdUser.outletId,
      name: createdUser.name,
      email: createdUser.email,
      role: createdUser.role,
      createdAt: createdUser.createdAt,
    }

    // ── 6. Return payload ──────────────────────────────────
    return {
      tenant: createdTenant,
      adminUser: sanitizedUser,
      outlet: createdOutlet,
    }

  } catch (err) {
    // ── Rollback ───────────────────────────────────────────
    if (createdOutlet) {
      await Outlet.findByIdAndDelete(createdOutlet._id).catch(() => {})
    }

    if (createdUser) {
      await User.findByIdAndDelete(createdUser._id).catch(() => {})
    }

    if (createdTenant) {
      await Tenant.findByIdAndDelete(createdTenant._id).catch(() => {})
    }

    throw err
  }
}

// ── getTenants ────────────────────────────────────────────────

/**
 * Paginated list of all tenants. Super_admin only.
 *
 * @param {Object} queryParams - { page, limit, isActive, plan, search }
 */
export const getTenants = async (queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = { deletedAt: null }

  if (queryParams.isActive !== undefined) {
    filter.isActive = queryParams.isActive === 'true'
  }

  if (queryParams.plan) {
    filter.plan = queryParams.plan
  }

  if (queryParams.search) {
    filter.$or = [
      { name: { $regex: queryParams.search.trim(), $options: 'i' } },
      { slug: { $regex: queryParams.search.trim(), $options: 'i' } },
    ]
  }

  const [tenants, total] = await Promise.all([
    Tenant.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Tenant.countDocuments(filter),
  ])

  return {
    tenants,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getTenantById ─────────────────────────────────────────────

export const getTenantById = async (tenantId) => {
  const tenant = await Tenant.findOne({
    _id:       new mongoose.Types.ObjectId(tenantId),
    deletedAt: null,
  }).lean()

  if (!tenant) throw new ApiError(404, 'Tenant not found')

  return tenant
}

// ── createTenant ──────────────────────────────────────────────

/**
 * Direct tenant creation by super_admin.
 * No user or outlet created — use bootstrapTenant for full setup.
 */
export const createTenant = async (data, createdByUserId) => {
  const slug = await generateUniqueSlug(data.name, data.slug)

  try {
    const tenant = await Tenant.create({
      name:      data.name.trim(),
      slug,
      plan:      data.plan ?? 'starter',
      isActive:  true,
      createdBy: createdByUserId
        ? new mongoose.Types.ObjectId(createdByUserId)
        : null,
    })

    return tenant.toObject()
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'A tenant with this slug already exists')
    }
    throw err
  }
}

// ── updateTenant ──────────────────────────────────────────────

/**
 * Updates mutable tenant fields.
 * slug is immutable — validated before reaching here.
 */
export const updateTenant = async (tenantId, data) => {
  const updateData = {}
  if (data.name     !== undefined) updateData.name     = data.name.trim()
  if (data.plan     !== undefined) updateData.plan     = data.plan
  if (data.isActive !== undefined) updateData.isActive = data.isActive

  const tenant = await Tenant.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(tenantId), deletedAt: null },
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!tenant) throw new ApiError(404, 'Tenant not found')

  return tenant
}

// ── softDeleteTenant ──────────────────────────────────────────

/**
 * Soft-deletes a tenant by setting deletedAt and isActive = false.
 * Does NOT delete associated Users, Employees, Outlets, etc.
 */
export const softDeleteTenant = async (tenantId) => {
  const tenant = await Tenant.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(tenantId), deletedAt: null },
    { $set: { isActive: false, deletedAt: new Date() } },
    { new: true }
  ).lean()

  if (!tenant) throw new ApiError(404, 'Tenant not found')
}