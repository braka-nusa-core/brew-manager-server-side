// ============================================================
// modules/inventory/inventory.validation.js
// Sprint 6.2 — Production Batch & Inventory Management.
//
// Request-shape validation only (format/range checks that don't need a
// DB round-trip). DB-dependent checks (inactive product, invalid outlet)
// live in inventory.service.js, mirroring the split already used by
// cup.validation.js / cup.service.js.
// ============================================================

import mongoose from 'mongoose'

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id)

// ── validateCreateProduction ──────────────────────────────────
//
// Body: { productId, quantity, producedAt, notes? }
// Outlet/tenant are NEVER read from the body — derived from the
// authenticated user (req.tenantId / req.outletId) in the controller.

export const validateCreateProduction = (body) => {
  const errors = []
  const { productId, quantity, producedAt, notes } = body ?? {}

  if (!productId) {
    errors.push('productId is required')
  } else if (!isValidObjectId(productId)) {
    errors.push('productId must be a valid ObjectId')
  }

  if (quantity === undefined || quantity === null) {
    errors.push('quantity is required')
  } else if (!Number.isInteger(quantity) || quantity <= 0) {
    errors.push('quantity must be a positive integer')
  }

  if (!producedAt) {
    errors.push('producedAt is required')
  } else {
    const producedDate = new Date(producedAt)
    if (Number.isNaN(producedDate.getTime())) {
      errors.push('producedAt must be a valid date')
    } else if (producedDate.getTime() > Date.now()) {
      errors.push('producedAt cannot be in the future')
    }
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  } else if (typeof notes === 'string' && notes.length > 500) {
    errors.push('notes must be at most 500 characters')
  }

  return { isValid: errors.length === 0, errors }
}