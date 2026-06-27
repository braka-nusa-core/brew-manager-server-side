// ============================================================
// modules/sales/sales.validation.js
// v1.1 — Phase 1 extension: paymentMethod field added.
// ============================================================

const OBJECT_ID_RE    = /^[a-f\d]{24}$/i
const PAYMENT_METHODS = ['cash', 'transfer', 'qris']

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

// ── validateCreateSale ────────────────────────────────────────

export const validateCreateSale = (body) => {
  const errors = []
  const { employeeId, date, totalCups, totalRevenue, notes, paymentMethod } = body

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (e.g. 2026-05-18)')
  }

  if (totalCups === undefined || totalCups === null) {
    errors.push('totalCups is required')
  } else if (typeof totalCups !== 'number' || isNaN(totalCups)) {
    errors.push('totalCups must be a number')
  } else if (totalCups < 0) {
    errors.push('totalCups cannot be negative')
  }

  if (totalRevenue === undefined || totalRevenue === null) {
    errors.push('totalRevenue is required')
  } else if (typeof totalRevenue !== 'number' || isNaN(totalRevenue)) {
    errors.push('totalRevenue must be a number')
  } else if (totalRevenue < 0) {
    errors.push('totalRevenue cannot be negative')
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  // paymentMethod — optional
  if (paymentMethod !== undefined && paymentMethod !== null) {
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      errors.push(`paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}`)
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateSale ────────────────────────────────────────

export const validateUpdateSale = (body) => {
  const errors = []
  const {
    tenantId, outletId, employeeId,
    date, totalCups, totalRevenue, notes, paymentMethod,
  } = body

  // Guard immutable fields
  if (tenantId   !== undefined) errors.push('tenantId cannot be changed')
  if (outletId   !== undefined) errors.push('outletId cannot be changed')
  if (employeeId !== undefined) errors.push('employeeId cannot be changed')

  // At least one mutable field required
  const hasMutableField = [date, totalCups, totalRevenue, notes, paymentMethod].some(
    (v) => v !== undefined
  )
  if (!hasMutableField) {
    errors.push('At least one field (date, totalCups, totalRevenue, notes, paymentMethod) must be provided')
  }

  if (date !== undefined && !isValidDate(date)) {
    errors.push('date must be a valid date string')
  }

  if (totalCups !== undefined) {
    if (typeof totalCups !== 'number' || isNaN(totalCups)) {
      errors.push('totalCups must be a number')
    } else if (totalCups < 0) {
      errors.push('totalCups cannot be negative')
    }
  }

  if (totalRevenue !== undefined) {
    if (typeof totalRevenue !== 'number' || isNaN(totalRevenue)) {
      errors.push('totalRevenue must be a number')
    } else if (totalRevenue < 0) {
      errors.push('totalRevenue cannot be negative')
    }
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  // paymentMethod — optional update
  if (paymentMethod !== undefined && paymentMethod !== null) {
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      errors.push(`paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}`)
    }
  }

  return { isValid: errors.length === 0, errors }
}