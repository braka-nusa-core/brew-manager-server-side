// ============================================================
// models/Product.model.js
// Product lookup table with HPP costing support (Phase 5b).
//
// MVP scope:
//   - name, isActive — core identity
//   - sellingPrice, cachedHPP — Phase 5b costing (see below)
//   - No recipes, no inventory — recipe lives in ProductRecipe model
//   - Tenant-scoped
//   - Soft delete via isActive = false
//
// Used as reference for CupRecord.items[].productId (unaffected
// by Phase 5b — CupRecord never reads sellingPrice or cachedHPP).
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

const productSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    name: {
      type:      String,
      required:  [true, 'Product name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    isActive: {
      type:    Boolean,
      default: true,
    },

    // ── HPP Costing fields (Phase 5b addition) ────────────────
    // sellingPrice: owner-set price per unit sold.
    // cachedHPP: server-computed cost, derived from ProductRecipe.
    //   Never client-writable directly — only productRecipe.service.js
    //   writes this field, via recalculateCachedHPP().
    //   Stale until next recipe PUT if a referenced RawMaterial's
    //   costPerUnit changes — documented MVP limitation, accepted.

    sellingPrice: {
      type:    Number,
      default: 0,
      min:     [0, 'sellingPrice cannot be negative'],
    },

    cachedHPP: {
      type:    Number,
      default: 0,
      min:     [0, 'cachedHPP cannot be negative'],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// Primary list query — tenant + active status
productSchema.index({ tenantId: 1, isActive: 1 })

// Name lookup within tenant — also enforces no duplicate names per tenant
productSchema.index({ tenantId: 1, name: 1 }, { unique: true })

const Product = model('Product', productSchema)

export default Product