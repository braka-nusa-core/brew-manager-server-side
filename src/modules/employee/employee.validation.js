// ============================================================
// modules/employee/employee.validation.js
// v1.1 — Phase 1 extension: employeeType field added.
// v1.2 — Payroll-config-follows-outlet extension:
//   salaryType/baseSalary are no longer unconditionally required
//   here — requiredness depends on the employee's Outlet.payrollType,
//   which requires a DB read. These functions stay synchronous and
//   DB-free (matching this module's convention); the conditional
//   requirement is enforced in employee.service.js, which fetches
//   the outlet immediately before create/update. This file still
//   validates salaryType/baseSalary's TYPE/ENUM/RANGE whenever they
//   ARE present, just no longer forces their presence unconditionally.
//   ktpStatus (administrative KTP tracking, no file upload) added.
//
// SYNC RULE [E3]: When employeeType = 'rider', the service
// automatically sets isRider = true. Validation does not
// enforce this — it is a service-layer concern.
// ============================================================

import mongoose from 'mongoose'
import { EMPLOYEE_TYPES, KTP_STATUSES } from '../../models/Employee.model.js'

const SALARY_TYPES  = ['monthly', 'daily']
const OBJECT_ID_RE  = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

// ── validateCreateEmployee ────────────────────────────────────

export const validateCreateEmployee = (body) => {
  const errors = []
  const {
    outletId, name, phone, position,
    salaryType, baseSalary, joinDate,
    employeeType, ktpStatus,
  } = body

  // outletId
  if (!outletId) {
    errors.push('outletId is required')
  } else if (!isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  // name
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  // phone (optional)
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  // position
  if (!position || typeof position !== 'string' || position.trim().length < 2) {
    errors.push('position is required and must be at least 2 characters')
  } else if (position.trim().length > 50) {
    errors.push('position must not exceed 50 characters')
  }

  // salaryType — no longer unconditionally required here. Whether it's
  // required depends on the employee's Outlet.payrollType, which this
  // synchronous, DB-free function cannot check — see employee.service.js,
  // which fetches the outlet and enforces the conditional requirement
  // immediately before create. Here we only check shape, when present.
  if (salaryType !== undefined && salaryType !== null && !SALARY_TYPES.includes(salaryType)) {
    errors.push(`salaryType must be one of: ${SALARY_TYPES.join(', ')}`)
  }

  // baseSalary — same conditional-requiredness note as salaryType above.
  if (baseSalary !== undefined && baseSalary !== null) {
    if (typeof baseSalary !== 'number' || isNaN(baseSalary)) {
      errors.push('baseSalary must be a number')
    } else if (baseSalary < 0) {
      errors.push('baseSalary cannot be negative')
    }
  }

  // joinDate
  if (!joinDate) {
    errors.push('joinDate is required')
  } else if (isNaN(Date.parse(joinDate))) {
    errors.push('joinDate must be a valid date')
  }

  // employeeType (optional — defaults to 'barista')
  if (employeeType !== undefined && !EMPLOYEE_TYPES.includes(employeeType)) {
    errors.push(`employeeType must be one of: ${EMPLOYEE_TYPES.join(', ')}`)
  }

  // ktpStatus (optional — defaults to 'pending')
  if (ktpStatus !== undefined && !KTP_STATUSES.includes(ktpStatus)) {
    errors.push(`ktpStatus must be one of: ${KTP_STATUSES.join(', ')}`)
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateEmployee ────────────────────────────────────

export const validateUpdateEmployee = (body) => {
  const errors = []
  const {
    tenantId, outletId, name, phone, position,
    salaryType, baseSalary, joinDate, isActive,
    employeeType, isRider, ktpStatus,
  } = body

  // Guard immutable field
  if (tenantId !== undefined) {
    errors.push('tenantId cannot be changed')
  }

  // isRider cannot be set directly — sync'd from employeeType in service
  if (isRider !== undefined) {
    errors.push('isRider is managed automatically. Set employeeType to "rider" instead.')
  }

  // outletId — can be updated (outlet reassignment)
  if (outletId !== undefined && !isValidObjectId(outletId)) {
    errors.push('outletId must be a valid ObjectId')
  }

  // name
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  // phone
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  // position
  if (position !== undefined) {
    if (typeof position !== 'string' || position.trim().length < 2) {
      errors.push('position must be at least 2 characters')
    } else if (position.trim().length > 50) {
      errors.push('position must not exceed 50 characters')
    }
  }

  // salaryType
  if (salaryType !== undefined && !SALARY_TYPES.includes(salaryType)) {
    errors.push(`salaryType must be one of: ${SALARY_TYPES.join(', ')}`)
  }

  // baseSalary
  if (baseSalary !== undefined) {
    if (typeof baseSalary !== 'number' || isNaN(baseSalary)) {
      errors.push('baseSalary must be a number')
    } else if (baseSalary < 0) {
      errors.push('baseSalary cannot be negative')
    }
  }

  // joinDate
  if (joinDate !== undefined && isNaN(Date.parse(joinDate))) {
    errors.push('joinDate must be a valid date')
  }

  // isActive — handled by toggle-active endpoint
  if (isActive !== undefined) {
    errors.push('Use the /toggle-active endpoint to change active status')
  }

  // employeeType
  if (employeeType !== undefined && !EMPLOYEE_TYPES.includes(employeeType)) {
    errors.push(`employeeType must be one of: ${EMPLOYEE_TYPES.join(', ')}`)
  }

  // ktpStatus (optional — independently updatable per spec)
  if (ktpStatus !== undefined && !KTP_STATUSES.includes(ktpStatus)) {
    errors.push(`ktpStatus must be one of: ${KTP_STATUSES.join(', ')}`)
  }

  return { isValid: errors.length === 0, errors }
}