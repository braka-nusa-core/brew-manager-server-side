// ============================================================
// modules/employee/employee.service.js
// All employee business logic and DB operations.
//
// Design decisions:
//   - Every function receives tenantId and user as explicit params.
//   - outletId scoping is applied conditionally based on user.role:
//       manager  → scoped to user.outletId
//       others   → unscoped (tenant-wide)
//   - Soft delete: isActive = false. Hard delete is never used.
//   - Search uses a case-insensitive regex on the name field.
//   - All queries use tenantId as the first filter — always.
//   - Lean queries used on reads for better performance.
// ============================================================

import mongoose from 'mongoose'
import Employee from '../../models/Employee.model.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { ROLES } from '../../constants/permissions.js'

// ── Query Builder ─────────────────────────────────────────────
// Centralizes how tenant + outlet scope is applied per role.
// Called at the start of every service function.

/**
 * Builds the base MongoDB query object with tenant and optional
 * outlet scope based on the authenticated user's role.
 *
 * Rules:
 *   - super_admin: no tenantId filter (tenantId arg may be null)
 *   - tenant_admin: tenantId only
 *   - manager/cashier: tenantId + outletId from token
 *
 * @param {string|null} tenantId
 * @param {Object} user - req.user
 * @returns {Object} Mongoose filter object
 */
const buildBaseQuery = (tenantId, user) => {
  const query = {}

  if (user.role === ROLES.SUPER_ADMIN) return query

  // Always cast to ObjectId — consistent with all other service modules
  query.tenantId = new mongoose.Types.ObjectId(tenantId)

  // Both manager and cashier are outlet-scoped (fix M1 + M3)
  if (
    (user.role === ROLES.MANAGER || user.role === ROLES.CASHIER) &&
    user.outletId
  ) {
    query.outletId = new mongoose.Types.ObjectId(user.outletId)
  }

  return query
}

// ── createEmployee ────────────────────────────────────────────

/**
 * Creates a new employee record.
 * tenantId always comes from the verified JWT context —
 * never from the request body.
 *
 * Manager role: outletId in body must match their own outletId.
 * tenant_admin: can assign any outletId within their tenant.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.data - validated req.body
 * @returns {Promise<Object>} Created employee document
 * @throws {Error} 403 if manager tries to create employee in another outlet
 */
export const createEmployee = async ({ tenantId, user, data }) => {
  // Managers can only create employees for their own outlet
  if (
    user.role === ROLES.MANAGER &&
    data.outletId !== user.outletId.toString()
  ) {
    const err = new Error('Managers can only create employees in their own outlet')
    err.statusCode = 403
    throw err
  }

  const employee = await Employee.create({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    outletId: new mongoose.Types.ObjectId(data.outletId),
    name:       data.name.trim(),
    phone:      data.phone?.trim() ?? null,
    position:   data.position.trim(),
    salaryType: data.salaryType,
    baseSalary: data.baseSalary,
    joinDate:   new Date(data.joinDate),
  })

  return employee
}

// ── getEmployees ──────────────────────────────────────────────

/**
 * Returns a paginated list of employees scoped to tenant/outlet.
 * Supports filtering by outletId, isActive, position, and name search.
 *
 * Filter priority:
 *   1. Role-based outlet scope (from token) — cannot be overridden by manager
 *   2. Optional query filters (outletId, isActive, position, search)
 *
 * @param {Object} params
 * @param {string|null} params.tenantId
 * @param {Object} params.user
 * @param {Object} params.queryParams - req.query
 * @returns {Promise<{ employees: Object[], pagination: Object }>}
 */
export const getEmployees = async ({ tenantId, user, queryParams }) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const query = buildBaseQuery(tenantId, user)

  // Additional filters from query params
  // Manager's outletId is already locked in buildBaseQuery —
  // an explicit outletId param from a manager is ignored silently.

  if (queryParams.outletId && user.role !== ROLES.MANAGER) {
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

/**
 * Returns a single employee by ID, scoped to tenant and outlet.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {string} params.employeeId
 * @returns {Promise<Object>} Employee document
 * @throws {Error} 404 if not found or out of scope
 */
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

/**
 * Updates allowed fields on an employee record.
 * tenantId is never updatable. outletId can be reassigned
 * by tenant_admin only — managers cannot move employees
 * to other outlets.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {string} params.employeeId
 * @param {Object} params.data - validated req.body
 * @returns {Promise<Object>} Updated employee document
 * @throws {Error} 404 if not found, 403 if outlet reassignment attempted by manager
 */
export const updateEmployee = async ({ tenantId, user, employeeId, data }) => {
  const query = buildBaseQuery(tenantId, user)
  query._id = new mongoose.Types.ObjectId(employeeId)

  // Prevent managers from reassigning employees to other outlets
  if (data.outletId && user.role === ROLES.MANAGER) {
    if (data.outletId !== user.outletId.toString()) {
      const err = new Error('Managers cannot reassign employees to other outlets')
      err.statusCode = 403
      throw err
    }
  }

  const updateData = {}
  if (data.outletId  !== undefined) updateData.outletId  = new mongoose.Types.ObjectId(data.outletId)
  if (data.name      !== undefined) updateData.name      = data.name.trim()
  if (data.phone     !== undefined) updateData.phone     = data.phone?.trim() ?? null
  if (data.position  !== undefined) updateData.position  = data.position.trim()
  if (data.salaryType !== undefined) updateData.salaryType = data.salaryType
  if (data.baseSalary !== undefined) updateData.baseSalary = data.baseSalary
  if (data.joinDate  !== undefined) updateData.joinDate  = new Date(data.joinDate)

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

/**
 * Flips the isActive flag on an employee record.
 * Used for both activation and deactivation.
 * The current state is toggled — no body value is trusted.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {string} params.employeeId
 * @returns {Promise<Object>} Updated employee document
 * @throws {Error} 404 if not found or out of scope
 */
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

/**
 * Soft-deletes an employee by setting isActive = false.
 * The record is preserved for payroll and attendance history.
 * Hard delete is NEVER performed.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} params.user
 * @param {string} params.employeeId
 * @returns {Promise<void>}
 * @throws {Error} 404 if not found or out of scope
 */
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

  // Return void — controller sends 204 No Content
}