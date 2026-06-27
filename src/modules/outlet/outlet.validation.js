// ============================================================
// modules/outlet/outlet.validation.js
// v1.1 — Phase 1 extension: payroll config fields added.
// ============================================================

const PAYROLL_TYPES = ['fixed', 'commission']

// ── validateCreateOutlet ──────────────────────────────────────

export const validateCreateOutlet = (body) => {
  const errors = []
  const {
    name, code, address, phone,
    payrollType, commissionPercentage, mealAllowancePerDay,
    weeklyAttendanceBonus, bonusRules,
  } = body

  // name
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  // code
  if (code !== undefined) {
    if (typeof code !== 'string' || code.trim().length < 2 || code.trim().length > 10) {
      errors.push('code must be between 2 and 10 characters')
    }
  }

  // address
  if (address !== undefined && address !== null && typeof address !== 'string') {
    errors.push('address must be a string')
  }

  // phone
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  // payrollType
  if (payrollType !== undefined && !PAYROLL_TYPES.includes(payrollType)) {
    errors.push(`payrollType must be one of: ${PAYROLL_TYPES.join(', ')}`)
  }

  // commissionPercentage
  if (commissionPercentage !== undefined) {
    const pct = Number(commissionPercentage)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      errors.push('commissionPercentage must be a number between 0 and 100')
    }
  }

  // mealAllowancePerDay
  if (mealAllowancePerDay !== undefined) {
    const val = Number(mealAllowancePerDay)
    if (isNaN(val) || val < 0) {
      errors.push('mealAllowancePerDay must be a non-negative number')
    }
  }

  // weeklyAttendanceBonus
  if (weeklyAttendanceBonus !== undefined) {
    const val = Number(weeklyAttendanceBonus)
    if (isNaN(val) || val < 0) {
      errors.push('weeklyAttendanceBonus must be a non-negative number')
    }
  }

  // bonusRules
  if (bonusRules !== undefined) {
    if (!Array.isArray(bonusRules)) {
      errors.push('bonusRules must be an array')
    } else {
      const seenMinCups = new Set()
      bonusRules.forEach((rule, i) => {
        if (typeof rule !== 'object' || rule === null) {
          errors.push(`bonusRules[${i}]: must be an object`)
          return
        }
        const minCups     = Number(rule.minCups)
        const bonusAmount = Number(rule.bonusAmount)
        if (!Number.isInteger(minCups) || minCups < 1) {
          errors.push(`bonusRules[${i}]: minCups must be a positive integer`)
        } else if (seenMinCups.has(minCups)) {
          errors.push(`bonusRules[${i}]: minCups ${minCups} is duplicated`)
        } else {
          seenMinCups.add(minCups)
        }
        if (!Number.isInteger(bonusAmount) || bonusAmount < 1) {
          errors.push(`bonusRules[${i}]: bonusAmount must be a positive integer`)
        }
      })
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateOutlet ──────────────────────────────────────

export const validateUpdateOutlet = (body) => {
  const errors = []
  const {
    tenantId, name, code, address, phone, isActive,
    payrollType, commissionPercentage, mealAllowancePerDay,
    weeklyAttendanceBonus, bonusRules,
  } = body

  // Guard immutable field
  if (tenantId !== undefined) {
    errors.push('tenantId cannot be changed')
  }

  // At least one mutable field required
  const mutableFields = [
    name, code, address, phone, isActive,
    payrollType, commissionPercentage, mealAllowancePerDay,
    weeklyAttendanceBonus, bonusRules,
  ]
  if (mutableFields.every((v) => v === undefined)) {
    errors.push('At least one field must be provided to update')
  }

  // name
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  // code
  if (code !== undefined) {
    if (typeof code !== 'string' || code.trim().length < 2 || code.trim().length > 10) {
      errors.push('code must be between 2 and 10 characters')
    }
  }

  // address
  if (address !== undefined && address !== null && typeof address !== 'string') {
    errors.push('address must be a string')
  }

  // phone
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    errors.push('phone must be a string')
  }

  // isActive
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean')
  }

  // payrollType
  if (payrollType !== undefined && !PAYROLL_TYPES.includes(payrollType)) {
    errors.push(`payrollType must be one of: ${PAYROLL_TYPES.join(', ')}`)
  }

  // commissionPercentage
  if (commissionPercentage !== undefined) {
    const pct = Number(commissionPercentage)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      errors.push('commissionPercentage must be a number between 0 and 100')
    }
  }

  // mealAllowancePerDay
  if (mealAllowancePerDay !== undefined) {
    const val = Number(mealAllowancePerDay)
    if (isNaN(val) || val < 0) {
      errors.push('mealAllowancePerDay must be a non-negative number')
    }
  }

  // weeklyAttendanceBonus
  if (weeklyAttendanceBonus !== undefined) {
    const val = Number(weeklyAttendanceBonus)
    if (isNaN(val) || val < 0) {
      errors.push('weeklyAttendanceBonus must be a non-negative number')
    }
  }

  // bonusRules
  if (bonusRules !== undefined) {
    if (!Array.isArray(bonusRules)) {
      errors.push('bonusRules must be an array')
    } else {
      const seenMinCups = new Set()
      bonusRules.forEach((rule, i) => {
        if (typeof rule !== 'object' || rule === null) {
          errors.push(`bonusRules[${i}]: must be an object`)
          return
        }
        const minCups     = Number(rule.minCups)
        const bonusAmount = Number(rule.bonusAmount)
        if (!Number.isInteger(minCups) || minCups < 1) {
          errors.push(`bonusRules[${i}]: minCups must be a positive integer`)
        } else if (seenMinCups.has(minCups)) {
          errors.push(`bonusRules[${i}]: minCups ${minCups} is duplicated`)
        } else {
          seenMinCups.add(minCups)
        }
        if (!Number.isInteger(bonusAmount) || bonusAmount < 1) {
          errors.push(`bonusRules[${i}]: bonusAmount must be a positive integer`)
        }
      })
    }
  }

  return { isValid: errors.length === 0, errors }
}