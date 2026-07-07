// ============================================================
// modules/employee/employee.service.js
// v1.2 — Phase 6A addition:
//   - generatePortalToken() for Rider Portal access
//
// v1.1 — Phase 1 extension:
//   - isRider sync with employeeType [E3]
//   - employeeType filter support in getEmployees
//   - isRider filter support in getEmployees
// ============================================================

import crypto   from 'crypto'
import mongoose from 'mongoose'
import Employee from '../../models/Employee.model.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'
import { checkPlanLimit } from '../../utils/checkPlanLimit.js'

// ── Query Builder ─────────────────────────────────────────────

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

// ── isRider sync helper ───────────────────────────────────────
// [E3] isRider is always derived from employeeType in service layer.
// Never trust isRider from request body — validation already rejects it.
const syncIsRider = (employeeType) => employeeType === 'rider'

// ── createEmployee ────────────────────────────────────────────

export const createEmployee = async ({ tenantId, user, data }) => {
  // Sprint 2: enforce plan employee limit before creating
  await checkPlanLimit(tenantId, 'employees')

  if (
    user.role === ROLES.MANAGER &&
    data.outletId !== user.outletId.toString()
  ) {
    const err = new Error('Managers can only create employees in their own outlet')
    err.statusCode = 403
    throw err
  }

  // [E3] Sync isRider from employeeType
  const employeeType = data.employeeType ?? 'barista'
  const isRider      = syncIsRider(employeeType)

  const employee = await Employee.create({
    tenantId:     new mongoose.Types.ObjectId(tenantId),
    outletId:     new mongoose.Types.ObjectId(data.outletId),
    name:         data.name.trim(),
    phone:        data.phone?.trim() ?? null,
    position:     data.position.trim(),
    salaryType:   data.salaryType,
    baseSalary:   data.baseSalary,
    joinDate:     new Date(data.joinDate),
    employeeType,
    isRider,
  })

  return employee
}

// ── getEmployees ──────────────────────────────────────────────

export const getEmployees = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  if (queryParams.outletId && user.role !== ROLES.MANAGER && user.role !== ROLES.CASHIER) {
    query.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.isActive !== undefined) {
    query.isActive = queryParams.isActive === 'true'
  }

  if (queryParams.position) {
    query.position = { $regex: queryParams.position.trim(), $options: 'i' }
  }

  if (queryParams.search) {
    query.name = { $regex: queryParams.search.trim(), $options: 'i' }
  }

  // Phase 1: filter by employeeType (e.g. ?type=rider)
  if (queryParams.type) {
    query.employeeType = queryParams.type
  }

  // Phase 1: filter riders only (e.g. ?isRider=true)
  if (queryParams.isRider !== undefined) {
    query.isRider = queryParams.isRider === 'true'
  }

  const [employees, total] = await Promise.all([
    Employee.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Employee.countDocuments(query),
  ])

  return {
    employees,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getEmployeeById ───────────────────────────────────────────

export const getEmployeeById = async ({ tenantId, user, employeeId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(employeeId)

  const employee = await Employee.findOne(query).lean()

  if (!employee) {
    const err = new Error('Employee not found')
    err.statusCode = 404
    throw err
  }

  return employee
}

// ── updateEmployee ────────────────────────────────────────────

export const updateEmployee = async ({ tenantId, user, employeeId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(employeeId)

  if (data.outletId && user.role === ROLES.MANAGER) {
    if (data.outletId !== user.outletId.toString()) {
      const err = new Error('Managers cannot reassign employees to other outlets')
      err.statusCode = 403
      throw err
    }
  }

  const updateData = {}
  if (data.outletId   !== undefined) updateData.outletId   = new mongoose.Types.ObjectId(data.outletId)
  if (data.name       !== undefined) updateData.name       = data.name.trim()
  if (data.phone      !== undefined) updateData.phone      = data.phone?.trim() ?? null
  if (data.position   !== undefined) updateData.position   = data.position.trim()
  if (data.salaryType !== undefined) updateData.salaryType = data.salaryType
  if (data.baseSalary !== undefined) updateData.baseSalary = data.baseSalary
  if (data.joinDate   !== undefined) updateData.joinDate   = new Date(data.joinDate)

  // [E3] Sync isRider if employeeType is being updated
  if (data.employeeType !== undefined) {
    updateData.employeeType = data.employeeType
    updateData.isRider      = syncIsRider(data.employeeType)
  }

  const employee = await Employee.findOneAndUpdate(
    query,
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!employee) {
    const err = new Error('Employee not found')
    err.statusCode = 404
    throw err
  }

  return employee
}

// ── toggleEmployeeActive ──────────────────────────────────────

export const toggleEmployeeActive = async ({ tenantId, user, employeeId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(employeeId)

  const employee = await Employee.findOne(query)

  if (!employee) {
    const err = new Error('Employee not found')
    err.statusCode = 404
    throw err
  }

  employee.isActive = !employee.isActive
  await employee.save()

  return employee.toObject()
}

// ── softDeleteEmployee ────────────────────────────────────────

export const softDeleteEmployee = async ({ tenantId, user, employeeId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(employeeId)

  const employee = await Employee.findOneAndUpdate(
    query,
    { $set: { isActive: false } },
    { new: true }
  ).lean()

  if (!employee) {
    const err = new Error('Employee not found')
    err.statusCode = 404
    throw err
  }
}

// ── generatePortalToken ────────────────────────────────────────
// Phase 6A addition.
//
// Generates a new Rider Portal access token for an employee.
// Manager/Admin only (enforced via MANAGE_EMPLOYEES at the route
// layer — reused, no new permission constant).
//
// Token format: 'rdr_' + 24 random bytes, base64url-encoded.
// crypto.randomBytes is Node's built-in module — no new dependency
// (uuid/nanoid are NOT installed in this project, confirmed in
// package.json before this decision was made).
//
// Only employees with isRider: true may have a portal generated —
// this is the business-rule guard requested ("rider portal", not
// "any employee portal"). Calling this again on a rider who
// already has a token OVERWRITES it — the previous link stops
// working immediately, which is the expected "regenerate" behavior.

export const generatePortalToken = async ({ tenantId, user, employeeId }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(employeeId)

  const employee = await Employee.findOne(query)

  if (!employee) {
    const err = new Error('Employee not found')
    err.statusCode = 404
    throw err
  }

  if (!employee.isRider) {
    const err = new Error('Portal access can only be generated for employees with employeeType "rider"')
    err.statusCode = 400
    throw err
  }

  const portalToken = `rdr_${crypto.randomBytes(24).toString('base64url')}`

  employee.portalToken = portalToken
  await employee.save()

  return portalToken
}