// ============================================================
// modules/productRecipe/productRecipe.validation.js
// Pure validation for product recipe operations.
// No Express dependency, no DB calls — independently testable.
//
// Cross-reference checks (productId exists, rawMaterialId exists
// and belongs to same tenant) are NOT done here — those require
// DB access and live in productRecipe.service.js, consistent with
// how cup.validation.js separates pure shape validation from
// cup.service.js's existence checks (e.g. isRider lookup).
// ============================================================

const OBJECT_ID_RE = /^[a-f\d]{24}$/i

const isValidObjectId = (id) =>
  typeof id === 'string' && OBJECT_ID_RE.test(id)

// ── validateUpsertRecipe ──────────────────────────────────────

/**
 * Validates request body for PUT /products/:productId/recipe.
 *
 * Rules:
 *   items required, non-empty array
 *   items[].rawMaterialId required, valid ObjectId
 *   items[].quantityUsed required, number > 0 (zero rejected)
 *   No duplicate rawMaterialId within items[]
 *
 * @param {Object} body - req.body
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateUpsertRecipe = (body) => {
  const errors = []
  const { items } = body

  if (!Array.isArray(items) || items.length === 0) {
    errors.push('items must be a non-empty array')
    return { isValid: false, errors }
  }

  const seenRawMaterialIds = new Set()

  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') {
      errors.push(`items[${i}]: must be an object`)
      return
    }

    // rawMaterialId
    if (!item.rawMaterialId) {
      errors.push(`items[${i}]: rawMaterialId is required`)
    } else if (!isValidObjectId(item.rawMaterialId)) {
      errors.push(`items[${i}]: rawMaterialId must be a valid ObjectId`)
    } else if (seenRawMaterialIds.has(item.rawMaterialId)) {
      errors.push(`items[${i}]: duplicate rawMaterialId — each material can only appear once in a recipe`)
    } else {
      seenRawMaterialIds.add(item.rawMaterialId)
    }

    // quantityUsed — must be strictly greater than 0
    if (item.quantityUsed === undefined || item.quantityUsed === null) {
      errors.push(`items[${i}]: quantityUsed is required`)
    } else if (typeof item.quantityUsed !== 'number' || isNaN(item.quantityUsed)) {
      errors.push(`items[${i}]: quantityUsed must be a number`)
    } else if (item.quantityUsed <= 0) {
      errors.push(`items[${i}]: quantityUsed must be greater than 0`)
    }
  })

  return { isValid: errors.length === 0, errors }
}