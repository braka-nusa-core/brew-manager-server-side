// ============================================================
// modules/employee/employee.service.js
// v1.3 — Payroll-config-follows-outlet extension:
//   - salaryType/baseSalary requiredness now depends on the
//     employee's Outlet.payrollType ('fixed' → required,
//     'commission' → ignored/nulled). The outlet is fetched here
//     (not duplicated onto Employee) immediately before create/update.
//   - ktpStatus (administrative tracking, no file upload) passthrough.
//
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
import Outlet   from '../../models/Outlet.model.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'
import { checkPlanLimit } from '../../utils/checkPlanLimit.js'

// ── Query Builder ─────────────────────────────────────────────

const SALARY_TYPES = ['monthly', 'daily']

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

// ── Outlet lookup helper ──────────────────────────────────────
// Employee inherits payroll behavior from its outlet — the outlet's
// payrollType is never duplicated onto the Employee document itself.
// This is the single place that fetches the outlet for that purpose;
// it also incidentally validates the outletId exists and belongs to
// the tenant (previously unchecked in createEmployee).
const fetchOutletOrThrow = async (tenantId, outletId) => {
  const outlet = await Outlet.findOne({
    _id:      new mongoose.Types.ObjectId(outletId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).lean()

  if (!outlet) {
    const err = new Error('Outlet not found')
    err.statusCode = 404
    throw err
  }

  return outlet
}

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

  // Employee payroll follows its outlet's payrollType — fetch it here,
  // never duplicated onto Employee. Also validates outletId exists and
  // belongs to this tenant.
  const outlet = await fetchOutletOrThrow(tenantId, data.outletId)

  let salaryType = null
  let baseSalary = 0

  if (outlet.payrollType === 'fixed') {
    // Fixed-payroll outlet: salaryType + baseSalary are required.
    // Do NOT trust the frontend — enforced here server-side.
    if (!data.salaryType || !SALARY_TYPES.includes(data.salaryType)) {
      const err = new Error('salaryType is required for employees at a fixed-payroll outlet')
      err.statusCode = 400
      throw err
    }
    if (data.baseSalary === undefined || data.baseSalary === null || typeof data.baseSalary !== 'number') {
      const err = new Error('baseSalary is required for employees at a fixed-payroll outlet')
      err.statusCode = 400
      throw err
    }
    salaryType = data.salaryType
    baseSalary = data.baseSalary
  }
  // else: outlet.payrollType === 'commission' — salaryType/baseSalary
  // are not required. If the frontend still sends them, they are
  // ignored; salaryType stays null, baseSalary stays 0. Payroll is
  // expected to calculate income entirely from the outlet's commission
  // configuration instead.

  // [E3] Sync isRider from employeeType
  const employeeType = data.employeeType ?? 'barista'
  const isRider      = syncIsRider(employeeType)

  const employee = await Employee.create({
    tenantId:     new mongoose.Types.ObjectId(tenantId),
    outletId:     new mongoose.Types.ObjectId(data.outletId),
    name:         data.name.trim(),
    phone:        data.phone?.trim() ?? null,
    position:     data.position.trim(),
    salaryType,
    baseSalary,
    joinDate:     new Date(data.joinDate),
    employeeType,
    isRider,
    ktpStatus:    data.ktpStatus ?? 'pending',
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

  const existing = await Employee.findOne(query).lean()

  if (!existing) {
    const err = new Error('Employee not found')
    err.statusCode = 404
    throw err
  }

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
  if (data.joinDate   !== undefined) updateData.joinDate   = new Date(data.joinDate)
  if (data.ktpStatus  !== undefined) updateData.ktpStatus  = data.ktpStatus

  // ── Employee payroll follows its (possibly newly-reassigned) outlet ──
  // Determine the EFFECTIVE outlet: the new one if being reassigned in
  // this same request, otherwise the employee's current outlet. Never
  // duplicate payroll config onto Employee — always re-fetch the outlet.
  const isReassigning   = data.outletId !== undefined && data.outletId !== existing.outletId.toString()
  const effectiveOutletId = data.outletId ?? existing.outletId.toString()
  const outlet = await fetchOutletOrThrow(tenantId, effectiveOutletId)

  if (outlet.payrollType === 'commission') {
    // Not required. If the frontend still sends them, ignore what was
    // sent for THIS request rather than rejecting it.
    if (data.salaryType !== undefined) { /* ignored — outlet is commission-based */ }
    if (data.baseSalary !== undefined) { /* ignored — outlet is commission-based */ }

    // Reassigning to a commission outlet: reset stale fixed-salary
    // numbers so the employee's stored data reflects its new outlet.
    // (Untouched employees that are simply being edited for unrelated
    // fields, with no outlet change, are left exactly as they are —
    // no destructive migration of existing data.)
    if (isReassigning) {
      updateData.salaryType = null
      updateData.baseSalary = 0
    }
  } else {
    // outlet.payrollType === 'fixed'
    if (data.salaryType !== undefined) updateData.salaryType = data.salaryType
    if (data.baseSalary !== undefined) updateData.baseSalary = data.baseSalary

    // Reassigning FROM a commission outlet (null/0 salary) INTO a fixed
    // outlet: the employee would land in an invalid "fixed but no
    // salary" state unless salary info is provided in this same request.
    const wasUnsalaried = existing.salaryType === null || existing.salaryType === undefined
    if (isReassigning && wasUnsalaried) {
      const hasSalaryType = updateData.salaryType !== undefined && SALARY_TYPES.includes(updateData.salaryType)
      const hasBaseSalary = updateData.baseSalary !== undefined && typeof updateData.baseSalary === 'number'
      if (!hasSalaryType || !hasBaseSalary) {
        const err = new Error('salaryType and baseSalary are required when reassigning an employee to a fixed-payroll outlet')
        err.statusCode = 400
        throw err
      }
    }
  }

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