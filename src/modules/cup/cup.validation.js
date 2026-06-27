// ============================================================
// modules/cup/cup.validation.js
// Pure validation for CupRecord operations.
//
// KEY RULE — finalize balance check:
//   Per product: (distributed + refill) === (sold + returned + reject)
//   All items must balance. Partial balance is NOT accepted.
// ============================================================

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

const isValidDate = (value) =>
  typeof value === 'string' && !isNaN(Date.parse(value))

const isNonNegativeInt = (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0

// ── validateItems ─────────────────────────────────────────────
// Shared item validation used by create and update.

const validateItems = (items, errors) => {
  if (!Array.isArray(items) || items.length === 0) {
    errors.push('items must be a non-empty array')
    return
  }

  const seenProductIds = new Set()

  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') {
      errors.push(`items[${i}]: must be an object`)
      return
    }

    // productId
    if (!item.productId) {
      errors.push(`items[${i}]: productId is required`)
    } else if (!isValidObjectId(item.productId)) {
      errors.push(`items[${i}]: productId must be a valid ObjectId`)
    } else if (seenProductIds.has(item.productId)) {
      errors.push(`items[${i}]: duplicate productId — each product can only appear once`)
    } else {
      seenProductIds.add(item.productId)
    }

    // Numeric fields — all optional on create (default 0), must be non-negative integers if provided
    const numericFields = ['distributed', 'refill', 'sold', 'returned', 'reject']
    numericFields.forEach((field) => {
      if (item[field] !== undefined && !isNonNegativeInt(item[field])) {
        errors.push(`items[${i}]: ${field} must be a non-negative integer`)
      }
    })
  })
}

// ── validateCreateCupRecord ───────────────────────────────────

/**
 * Validates body for creating a CupRecord (draft).
 * riderId must be provided — isRider check happens in service.
 * tenantId and outletId come from JWT — never from body.
 *
 * @param {Object} body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateCupRecord = (body) => {
  const errors = []
  const { riderId, date, items } = body

  if (!riderId) {
    errors.push('riderId is required')
  } else if (!isValidObjectId(riderId)) {
    errors.push('riderId must be a valid ObjectId')
  }

  if (!date) {
    errors.push('date is required')
  } else if (!isValidDate(date)) {
    errors.push('date must be a valid date string (YYYY-MM-DD)')
  }

  if (items === undefined) {
    errors.push('items is required')
  } else {
    validateItems(items, errors)
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateCupRecord ───────────────────────────────────

/**
 * Validates body for updating a CupRecord (draft only).
 * riderId and date are immutable after creation.
 * At least one of items or notes must be provided.
 *
 * @param {Object} body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateCupRecord = (body) => {
  const errors = []
  const { riderId, date, tenantId, outletId, status, items, notes } = body

  // Guard immutable fields
  if (riderId   !== undefined) errors.push('riderId cannot be changed after creation')
  if (date      !== undefined) errors.push('date cannot be changed after creation')
  if (tenantId  !== undefined) errors.push('tenantId cannot be changed')
  if (outletId  !== undefined) errors.push('outletId cannot be changed')
  if (status    !== undefined) errors.push('Use the /finalize endpoint to change status')

  // At least one mutable field
  if (items === undefined && notes === undefined) {
    errors.push('At least one of items or notes must be provided')
  }

  if (items !== undefined) {
    validateItems(items, errors)
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string or null')
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateFinalize ──────────────────────────────────────────

/**
 * Validates that all product items are balanced before finalizing.
 *
 * Balance rule (per item):
 *   carried     = distributed + refill
 *   accounted   = sold + returned + reject
 *   balanced    = carried === accounted
 *
 * ALL items must be balanced for finalization to succeed.
 * Partial balance is not accepted — one unbalanced item fails all.
 *
 * @param {Array} items - the items array from the CupRecord document
 * @param {Function} getProductName - optional (productId) => name for error messages
 * @returns {{
 *   isValid: boolean,
 *   errors: string[],
 *   breakdown: Array<{productId, carried, accounted, difference, balanced}>
 * }}
 */
export const validateFinalize = (items, getProductName) => {
  const errors    = []
  const breakdown = []

  items.forEach((item) => {
    const carried    = (item.distributed ?? 0) + (item.refill ?? 0)
    const accounted  = (item.sold ?? 0) + (item.returned ?? 0) + (item.reject ?? 0)
    const difference = carried - accounted
    const balanced   = difference === 0

    const productLabel = getProductName
      ? getProductName(item.productId?.toString())
      : item.productId?.toString()

    breakdown.push({
      productId:   item.productId,
      productName: productLabel,
      carried,
      accounted,
      difference,
      balanced,
    })

    if (!balanced) {
      const sign = difference > 0 ? '+' : ''
      errors.push(
        `Product "${productLabel}": carried ${carried}, accounted ${accounted} (difference: ${sign}${difference})`
      )
    }
  })

  return {
    isValid: errors.length === 0,
    errors:  errors.length > 0
      ? ['Cup reconciliation failed — the following products are unbalanced:', ...errors]
      : [],
    breakdown,
  }
}