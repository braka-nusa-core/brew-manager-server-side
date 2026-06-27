// ============================================================
// modules/bikeAssignment/bikeAssignment.service.js
// All bike assignment business logic.
//
// IMPORTANT (per approved spec): does NOT auto-close previous
// assignments. If a bike or rider already has an active
// assignment, creation is REJECTED with a validation error.
// The manager must explicitly call PATCH /:assignmentId/end
// before creating a new one. This is a deliberate UX choice —
// it forces an explicit, auditable "end" action rather than
// silently overwriting assignment history.
//
// DUAL PROTECTION (mirrors approved spec):
//   1. Service-layer check-then-create (this file) — gives a
//      clean, specific error message.
//   2. Partial unique indexes on BikeAssignment.model.js — final
//      protection against race conditions if two requests pass
//      the service check simultaneously (E11000 duplicate key).
// ============================================================

import mongoose        from 'mongoose'
import BikeAssignment   from '../../models/BikeAssignment.model.js'
import Bike              from '../../models/Bike.model.js'
import Employee          from '../../models/Employee.model.js'
import ApiError          from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── createAssignment ──────────────────────────────────────────

export const createAssignment = async (tenantId, data) => {
  const tenantOid = new mongoose.Types.ObjectId(tenantId)
  const bikeOid   = new mongoose.Types.ObjectId(data.bikeId)
  const empOid    = new mongoose.Types.ObjectId(data.employeeId)

  // ── Validate bike exists, is active, and is ACTIVE status ──
  const bike = await Bike.findOne({ _id: bikeOid, tenantId: tenantOid }).lean()
  if (!bike) throw new ApiError(404, 'Bike not found')
  if (!bike.isActive) throw new ApiError(400, 'This bike has been deactivated and cannot be assigned')
  if (bike.status !== 'ACTIVE') {
    throw new ApiError(400, `Bike status is "${bike.status}" — only ACTIVE bikes can be assigned`)
  }

  // ── Validate employee exists and is a rider ─────────────────
  const employee = await Employee.findOne({ _id: empOid, tenantId: tenantOid }).lean()
  if (!employee) throw new ApiError(404, 'Employee not found')
  if (!employee.isRider) {
    throw new ApiError(400, 'Only employees with employeeType "rider" can be assigned a bike')
  }

  // ── Reject if bike already has an active assignment ────────
  const bikeActive = await BikeAssignment.findOne({
    tenantId: tenantOid,
    bikeId:   bikeOid,
    endDate:  null,
  }).lean()
  if (bikeActive) {
    throw new ApiError(409, 'This bike already has an active assignment. End it before creating a new one.')
  }

  // ── Reject if rider already has an active assignment ───────
  const riderActive = await BikeAssignment.findOne({
    tenantId:   tenantOid,
    employeeId: empOid,
    endDate:    null,
  }).lean()
  if (riderActive) {
    throw new ApiError(409, 'This rider already has an active bike assignment. End it before assigning a new bike.')
  }

  try {
    const assignment = await BikeAssignment.create({
      tenantId:   tenantOid,
      bikeId:     bikeOid,
      employeeId: empOid,
      startDate:  new Date(data.startDate),
      endDate:    null,
    })
    return assignment.toObject()
  } catch (err) {
    // Final race-condition protection — the partial unique index
    // rejects this if another request slipped through between
    // our check above and this insert.
    if (err.code === 11000) {
      throw new ApiError(409, 'This bike or rider already has an active assignment (concurrent request detected)')
    }
    throw err
  }
}

// ── getAssignments ────────────────────────────────────────────

export const getAssignments = async (tenantId, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = { tenantId: new mongoose.Types.ObjectId(tenantId) }

  if (queryParams.bikeId)     filter.bikeId     = new mongoose.Types.ObjectId(queryParams.bikeId)
  if (queryParams.employeeId) filter.employeeId = new mongoose.Types.ObjectId(queryParams.employeeId)

  if (queryParams.active === 'true')  filter.endDate = null
  if (queryParams.active === 'false') filter.endDate = { $ne: null }

  const [assignments, total] = await Promise.all([
    BikeAssignment.find(filter)
      .sort({ startDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BikeAssignment.countDocuments(filter),
  ])

  return { assignments, pagination: buildPaginationMeta({ total, page, limit }) }
}

// ── getActiveAssignments ──────────────────────────────────────
// GET /api/v1/bike-assignments/active
// Built specifically for operational dashboards and frontend
// dropdowns — denormalized with bike/rider names for direct display.

export const getActiveAssignments = async (tenantId) => {
  const assignments = await BikeAssignment.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    endDate:  null,
  }).lean()

  if (assignments.length === 0) return []

  const bikeIds = assignments.map((a) => a.bikeId)
  const empIds  = assignments.map((a) => a.employeeId)

  const [bikes, employees] = await Promise.all([
    Bike.find({ _id: { $in: bikeIds } }).select('assetCode name').lean(),
    Employee.find({ _id: { $in: empIds } }).select('name').lean(),
  ])

  const bikeMap = new Map(bikes.map((b) => [b._id.toString(), b]))
  const empMap  = new Map(employees.map((e) => [e._id.toString(), e]))

  return assignments.map((a) => ({
    bikeId:    a.bikeId,
    bikeName:  bikeMap.get(a.bikeId.toString())?.name ?? null,
    assetCode: bikeMap.get(a.bikeId.toString())?.assetCode ?? null,
    riderId:   a.employeeId,
    riderName: empMap.get(a.employeeId.toString())?.name ?? null,
    startDate: a.startDate,
  }))
}

// ── endAssignment ─────────────────────────────────────────────
// PATCH /:assignmentId/end — sets endDate = now.
// Rejects if the assignment is already ended.

export const endAssignment = async (tenantId, assignmentId) => {
  const assignment = await BikeAssignment.findOne({
    _id:      new mongoose.Types.ObjectId(assignmentId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })

  if (!assignment) throw new ApiError(404, 'Assignment not found')

  if (assignment.endDate !== null) {
    throw new ApiError(409, 'This assignment has already ended')
  }

  assignment.endDate = new Date()
  await assignment.save()

  return assignment.toObject()
}