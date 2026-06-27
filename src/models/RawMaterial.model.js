// ============================================================
// models/RawMaterial.model.js
// Lightweight raw material lookup table for HPP costing.
//
// MVP scope (approved Business Requirement Analysis):
//   - name, unit, costPerUnit, isActive ONLY
//   - No supplier, no stock/inventory tracking, no reorder point
//   - Tenant-scoped
//   - Soft delete via isActive = false
//
// Used as reference for ProductRecipe.items[].rawMaterialId (Phase 5b).
// Inventory/stock tracking is explicitly deferred — see Business
// Requirement Analysis section 4.
// ============================================================

import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const RAW_MATERIAL_UNITS = ['g', 'kg', 'ml', 'l', 'pcs']

const rawMaterialSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },

    name: {
      type:      String,
      required:  [true, 'Raw material name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    unit: {
      type:    String,
      required: [true, 'Unit is required'],
      enum:    {
        values:  RAW_MATERIAL_UNITS,
        message: `unit must be one of: ${RAW_MATERIAL_UNITS.join(', ')}`,
      },
    },

    costPerUnit: {
      type:     Number,
      required: [true, 'Cost per unit is required'],
      min:      [0, 'costPerUnit cannot be negative'],
    },

    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
)

// ── Indexes ───────────────────────────────────────────────────

// Primary list query — tenant + active status
rawMaterialSchema.index({ tenantId: 1, isActive: 1 })

// Name lookup within tenant — also enforces no duplicate names per tenant
rawMaterialSchema.index({ tenantId: 1, name: 1 }, { unique: true })

const RawMaterial = model('RawMaterial', rawMaterialSchema)

export default RawMaterial