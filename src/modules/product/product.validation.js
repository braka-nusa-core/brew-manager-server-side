// ============================================================
// modules/product/product.validation.js
// Pure validation for product operations.
// No Express dependency — independently testable.
// ============================================================

// ── validateCreateProduct ─────────────────────────────────────

/**
 * Validates request body for creating a product.
 * tenantId comes from req.tenantId (JWT) — never validated here.
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateCreateProduct = (body) => {
  const errors = []
  const { name, sellingPrice } = body

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters')
  } else if (name.trim().length > 100) {
    errors.push('name must not exceed 100 characters')
  }

  // sellingPrice — optional on create, defaults to 0 in model
  if (sellingPrice !== undefined) {
    if (typeof sellingPrice !== 'number' || isNaN(sellingPrice)) {
      errors.push('sellingPrice must be a number')
    } else if (sellingPrice < 0) {
      errors.push('sellingPrice cannot be negative')
    }
  }

  return { isValid: errors.length === 0, errors }
}

// ── validateUpdateProduct ─────────────────────────────────────

/**
 * Validates request body for updating a product.
 * Mutable: name, isActive, sellingPrice.
 * Immutable: tenantId, cachedHPP (server-computed only, written
 * exclusively by productRecipe.service.js → recalculateCachedHPP()).
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpdateProduct = (body) => {
  const errors = []
  const { tenantId, name, isActive, sellingPrice, cachedHPP } = body

  // Guard immutable fields
  if (tenantId !== undefined) {
    errors.push('tenantId cannot be changed')
  }
  if (cachedHPP !== undefined) {
    errors.push('cachedHPP is server-computed from the product recipe and cannot be set directly')
  }

  // At least one mutable field required
  if (name === undefined && isActive === undefined && sellingPrice === undefined) {
    errors.push('At least one of name, isActive, or sellingPrice must be provided')
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      errors.push('name must be at least 2 characters')
    } else if (name.trim().length > 100) {
      errors.push('name must not exceed 100 characters')
    }
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean')
  }

  if (sellingPrice !== undefined) {
    if (typeof sellingPrice !== 'number' || isNaN(sellingPrice)) {
      errors.push('sellingPrice must be a number')
    } else if (sellingPrice < 0) {
      errors.push('sellingPrice cannot be negative')
    }
  }

  return { isValid: errors.length === 0, errors }
}