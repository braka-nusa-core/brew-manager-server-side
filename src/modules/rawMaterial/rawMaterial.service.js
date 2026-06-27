// ============================================================
// modules/rawMaterial/rawMaterial.service.js
// All raw material business logic.
// Mirrors product.service.js exactly.
//
// Soft delete: isActive = false (no hard delete for MVP).
// Raw materials are tenant-scoped — all queries require tenantId.
// Name uniqueness enforced at DB level (unique index per tenant).
// ============================================================

import mongoose    from 'mongoose'
import RawMaterial from '../../models/RawMaterial.model.js'
import ApiError    from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── createRawMaterial ─────────────────────────────────────────

/**
 * Creates a new raw material scoped to the given tenant.
 * tenantId always comes from req.tenantId (middleware context).
 *
 * @param {string} tenantId
 * @param {Object} data - validated req.body { name, unit, costPerUnit }
 * @returns {Promise<Object>} created raw material
 */
export const createRawMaterial = async (tenantId, data) => {
  try {
    const rawMaterial = await RawMaterial.create({
      tenantId:    new mongoose.Types.ObjectId(tenantId),
      name:        data.name.trim(),
      unit:        data.unit,
      costPerUnit: data.costPerUnit,
    })
    return rawMaterial.toObject()
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `A raw material named "${data.name.trim()}" already exists in this tenant`)
    }
    throw err
  }
}

// ── getRawMaterials ────────────────────────────────────────────

/**
 * Paginated list of raw materials for a tenant.
 * Supports filtering by isActive and name search.
 *
 * @param {string} tenantId
 * @param {Object} queryParams - { page, limit, search, isActive }
 * @returns {Promise<{ rawMaterials, pagination }>}
 */
export const getRawMaterials = async (tenantId, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }

  // isActive filter — default: show all (no filter)
  if (queryParams.isActive !== undefined) {
    filter.isActive = queryParams.isActive === 'true'
  }

  // Name search
  if (queryParams.search) {
    filter.name = { $regex: queryParams.search.trim(), $options: 'i' }
  }

  const [rawMaterials, total] = await Promise.all([
    RawMaterial.find(filter)
      .sort({ name: 1 })         // alphabetical — reference data
      .skip(skip)
      .limit(limit)
      .lean(),
    RawMaterial.countDocuments(filter),
  ])

  return {
    rawMaterials,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getRawMaterialById ────────────────────────────────────────

/**
 * Fetches a single raw material by ID, scoped to tenant.
 *
 * @param {string} tenantId
 * @param {string} rawMaterialId
 * @returns {Promise<Object>} raw material document
 */
export const getRawMaterialById = async (tenantId, rawMaterialId) => {
  const rawMaterial = await RawMaterial.findOne({
    _id:      new mongoose.Types.ObjectId(rawMaterialId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).lean()

  if (!rawMaterial) throw new ApiError(404, 'Raw material not found')

  return rawMaterial
}

// ── updateRawMaterial ─────────────────────────────────────────

/**
 * Updates a raw material's name, unit, costPerUnit, and/or isActive.
 * tenantId is immutable (validated in validation layer).
 *
 * @param {string} tenantId
 * @param {string} rawMaterialId
 * @param {Object} data - { name?, unit?, costPerUnit?, isActive? }
 * @returns {Promise<Object>} updated raw material
 */
export const updateRawMaterial = async (tenantId, rawMaterialId, data) => {
  const updateData = {}
  if (data.name        !== undefined) updateData.name        = data.name.trim()
  if (data.unit        !== undefined) updateData.unit        = data.unit
  if (data.costPerUnit !== undefined) updateData.costPerUnit = data.costPerUnit
  if (data.isActive    !== undefined) updateData.isActive    = data.isActive

  try {
    const rawMaterial = await RawMaterial.findOneAndUpdate(
      {
        _id:      new mongoose.Types.ObjectId(rawMaterialId),
        tenantId: new mongoose.Types.ObjectId(tenantId),
      },
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean()

    if (!rawMaterial) throw new ApiError(404, 'Raw material not found')

    return rawMaterial
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `A raw material named "${data.name?.trim()}" already exists in this tenant`)
    }
    throw err
  }
}

// ── softDeleteRawMaterial ─────────────────────────────────────

/**
 * Soft-deletes a raw material by setting isActive = false.
 * Record is preserved — it may be referenced by existing
 * ProductRecipe history (Phase 5b).
 *
 * @param {string} tenantId
 * @param {string} rawMaterialId
 * @returns {Promise<void>}
 */
export const softDeleteRawMaterial = async (tenantId, rawMaterialId) => {
  const rawMaterial = await RawMaterial.findOneAndUpdate(
    {
      _id:      new mongoose.Types.ObjectId(rawMaterialId),
      tenantId: new mongoose.Types.ObjectId(tenantId),
    },
    { $set: { isActive: false } },
    { new: true }
  ).lean()

  if (!rawMaterial) throw new ApiError(404, 'Raw material not found')
}