// ============================================================
// modules/bike/bike.service.js
// All bike business logic.
//
// Soft delete: isActive = false. Never deletedAt — see header
// note on Bike.model.js for the status-vs-isActive distinction.
// ============================================================

import mongoose          from 'mongoose'
import Bike               from '../../models/Bike.model.js'
import BikeDamageReport   from '../../models/BikeDamageReport.model.js'
import Outlet             from '../../models/Outlet.model.js'
import ApiError           from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'
import { notifyBikeMaintenanceOverdue } from '../notification/notification.service.js'
import { checkPlanLimit } from '../../utils/checkPlanLimit.js'

// ── Base query builder ────────────────────────────────────────
// Mirrors employee.service.js / outlet.service.js exactly —
// manager/cashier scoped to their own outlet, admin sees all
// within tenant, super_admin sees across tenants.

const buildBaseQuery = (tenantId, user) => {
  const query = {}

  if (user.role === ROLES.SUPER_ADMIN) return query

  query.tenantId = new mongoose.Types.ObjectId(tenantId)

  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    user.outletId
  ) {
    query.outletId = new mongoose.Types.ObjectId(user.outletId)
  }

  return query
}

// ── createBike ────────────────────────────────────────────────

export const createBike = async ({ tenantId, user, data }) => {
  // Sprint 2: enforce plan bike limit before creating
  await checkPlanLimit(tenantId, 'bikes')

  if (
    user.role === ROLES.MANAGER &&
    data.outletId !== user.outletId.toString()
  ) {
    throw new ApiError(403, 'Managers can only create bikes in their own outlet')
  }

  try {
    const bike = await Bike.create({
      tenantId:  new mongoose.Types.ObjectId(tenantId),
      outletId:  new mongoose.Types.ObjectId(data.outletId),
      assetCode: data.assetCode.trim().toUpperCase(),
      name:      data.name.trim(),
      notes:     data.notes?.trim() ?? null,
      // status omitted — schema default ACTIVE applies
    })
    return bike.toObject()
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `A bike with asset code "${data.assetCode.trim().toUpperCase()}" already exists in this tenant`)
    }
    throw err
  }
}

// ── getBikes ──────────────────────────────────────────────────

export const getBikes = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  if (queryParams.outletId && user.role !== ROLES.MANAGER && user.role !== ROLES.CASHIER) {
    query.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.status) {
    query.status = queryParams.status
  }

  if (queryParams.isActive !== undefined) {
    query.isActive = queryParams.isActive === 'true'
  }

  if (queryParams.search) {
    query.$or = [
      { name:      { $regex: queryParams.search.trim(), $options: 'i' } },
      { assetCode: { $regex: queryParams.search.trim(), $options: 'i' } },
    ]
  }

  const [bikes, total] = await Promise.all([
    Bike.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Bike.countDocuments(query),
  ])

  return { bikes, pagination: buildPaginationMeta({ total, page, limit }) }
}

// ── getBikeById ───────────────────────────────────────────────

export const getBikeById = async ({ tenantId, user, bikeId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(bikeId)

  const bike = await Bike.findOne(query).lean()
  if (!bike) throw new ApiError(404, 'Bike not found')

  return bike
}

// ── updateBike ────────────────────────────────────────────────
// Allowed: name, assetCode, notes, outletId. NOT status/isActive
// — already rejected in validation layer before this runs.

export const updateBike = async ({ tenantId, user, bikeId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(bikeId)

  if (data.outletId && user.role === ROLES.MANAGER) {
    if (data.outletId !== user.outletId.toString()) {
      throw new ApiError(403, 'Managers cannot reassign bikes to other outlets')
    }
  }

  const updateData = {}
  if (data.name      !== undefined) updateData.name      = data.name.trim()
  if (data.assetCode !== undefined) updateData.assetCode = data.assetCode.trim().toUpperCase()
  if (data.notes     !== undefined) updateData.notes     = data.notes?.trim() ?? null
  if (data.outletId  !== undefined) updateData.outletId  = new mongoose.Types.ObjectId(data.outletId)

  try {
    const bike = await Bike.findOneAndUpdate(
      query,
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean()

    if (!bike) throw new ApiError(404, 'Bike not found')
    return bike
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `A bike with asset code "${data.assetCode?.trim().toUpperCase()}" already exists in this tenant`)
    }
    throw err
  }
}

// ── updateBikeStatus ──────────────────────────────────────────
// Dedicated status-transition function (PATCH /:bikeId/status).
//
// BUSINESS RULE: a bike cannot become ACTIVE while it has any
// BikeDamageReport with status OPEN or IN_REPAIR. This requires a
// DB lookup, hence it lives in the service layer, not the pure
// validation layer (validateBikeStatus only checks the enum shape).

export const updateBikeStatus = async ({ tenantId, user, bikeId, status }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(bikeId)

  const bike = await Bike.findOne(query)
  if (!bike) throw new ApiError(404, 'Bike not found')

  if (status === 'ACTIVE') {
    const openDamageCount = await BikeDamageReport.countDocuments({
      tenantId: bike.tenantId,
      bikeId:   bike._id,
      status:   { $in: ['OPEN', 'IN_REPAIR'] },
    })

    if (openDamageCount > 0) {
      throw new ApiError(
        400,
        `Cannot set bike to ACTIVE — ${openDamageCount} unresolved damage report(s) exist. Resolve them first.`
      )
    }
  }

  bike.status = status
  await bike.save()

  return bike.toObject()
}

// ── softDeleteBike ────────────────────────────────────────────
// Soft delete ONLY — sets isActive = false. Never deletedAt,
// never a hard delete. Mirrors Employee/Product/RawMaterial.

export const softDeleteBike = async ({ tenantId, user, bikeId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(bikeId)

  const bike = await Bike.findOneAndUpdate(
    query,
    { $set: { isActive: false } },
    { new: true }
  ).lean()

  if (!bike) throw new ApiError(404, 'Bike not found')
}

// ── getMaintenanceDashboard ───────────────────────────────────
// GET /api/v1/bikes/maintenance
//
// Returns ONLY damage reports with status OPEN or IN_REPAIR —
// RESOLVED reports are excluded entirely. daysOpen is computed
// dynamically on every read, never stored (mirrors CupRecord's
// balance and Product's marginPercentage — computed-on-read
// principle used consistently across this codebase).

export const getMaintenanceDashboard = async ({ tenantId, user }) => {
  const bikeQuery = buildBaseQuery(tenantId, user)

  // Resolve which bikeIds are in scope for this user first, since
  // BikeDamageReport does not carry outletId directly — it only
  // references bikeId. This keeps the manager/cashier outlet-scope
  // restriction correct without duplicating outletId onto every
  // damage report document.
  const scopedBikes = await Bike.find(bikeQuery).select('_id assetCode name outletId').lean()

  if (scopedBikes.length === 0) return []

  const bikeMap = new Map(scopedBikes.map((b) => [b._id.toString(), b]))
  const bikeIds = scopedBikes.map((b) => b._id)

  const reportFilter = {
    bikeId: { $in: bikeIds },
    status: { $in: ['OPEN', 'IN_REPAIR'] },
  }
  if (user.role !== ROLES.SUPER_ADMIN) {
    reportFilter.tenantId = new mongoose.Types.ObjectId(tenantId)
  }

  const reports = await BikeDamageReport.find(reportFilter)
    .sort({ reportedAt: 1 })
    .lean()

  const outletIds = [...new Set(scopedBikes.map((b) => b.outletId.toString()))]
  const outlets    = await Outlet.find({ _id: { $in: outletIds } }).select('name').lean()
  const outletMap  = new Map(outlets.map((o) => [o._id.toString(), o.name]))

  const now = Date.now()

  // ── Notification Center addition ────────────────────────────
  // No scheduler exists in this codebase — "overdue" is evaluated
  // lazily here, on every dashboard read, since this is the one
  // place daysOpen is already computed for every open report.
  // notifyBikeMaintenanceOverdue is self-deduplicating (skips if
  // already notified for this exact report) and never throws, so
  // this cannot create duplicate notifications or break this read.
  for (const report of reports) {
    const bike = bikeMap.get(report.bikeId.toString())
    const daysOpen = Math.floor((now - report.reportedAt.getTime()) / 86400000)

    await notifyBikeMaintenanceOverdue({
      tenantId:       report.tenantId,
      outletId:       bike?.outletId,
      bike,
      damageReportId: report._id,
      daysOpen,
    })
  }

  return reports.map((report) => {
    const bike = bikeMap.get(report.bikeId.toString())
    const daysOpen = Math.floor((now - report.reportedAt.getTime()) / 86400000)

    return {
      bikeId:     report.bikeId,
      bikeName:   bike?.name ?? null,
      assetCode:  bike?.assetCode ?? null,
      outlet:     bike ? outletMap.get(bike.outletId.toString()) ?? null : null,
      damageType: report.damageType,
      severity:   report.severity,
      status:     report.status,
      reportedAt: report.reportedAt,
      daysOpen,
    }
  })
}