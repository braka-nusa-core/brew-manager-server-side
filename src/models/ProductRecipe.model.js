// ============================================================
// models/ProductRecipe.model.js
// One recipe per product — defines which raw materials and how
// much of each are needed to make one unit of a product.
//
// Used exclusively to compute Product.cachedHPP:
//   cachedHPP = SUM( item.quantityUsed × rawMaterial.costPerUnit )
//
// This calculation is owned by productRecipe.service.js, NOT by
// product.service.js — see recalculateCachedHPP() in this module.
//
// Embedded items[] pattern mirrors CupRecord.model.js exactly
// (_id: false on subdocuments, single parent doc per relationship).
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

// ── Embedded item schema ──────────────────────────────────────

const recipeItemSchema = new Schema(
  {
    rawMaterialId: {
      type:     Schema.Types.ObjectId,
      ref:      'RawMaterial',
      required: [true, 'Raw material ID is required per recipe item'],
    },

    // Quantity of this raw material consumed per ONE unit of product.
    // Unit matches RawMaterial.unit (g, kg, ml, l, pcs) — not stored
    // redundantly here, looked up via rawMaterialId when needed.
    quantityUsed: {
      type:     Number,
      required: [true, 'quantityUsed is required per recipe item'],
      min:      [0.0001, 'quantityUsed must be greater than 0'],
    },
  },
  {
    _id: false, // suppress auto _id on subdocuments — matches CupRecord convention
  }
)

// ── ProductRecipe schema ──────────────────────────────────────

const productRecipeSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    productId: {
      type:     Schema.Types.ObjectId,
      ref:      'Product',
      required: [true, 'Product ID is required'],
    },

    // At least one item required — enforced in validation layer,
    // not here, to produce a clean 400 rather than a Mongoose
    // ValidationError surfaced as a generic 500.
    items: {
      type:    [recipeItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// One recipe per product, per tenant — enforced at DB level.
productRecipeSchema.index({ tenantId: 1, productId: 1 }, { unique: true })

const ProductRecipe = model('ProductRecipe', productRecipeSchema)

export default ProductRecipe