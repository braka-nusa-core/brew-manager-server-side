// ============================================================
// modules/product/product.service.js
// All product business logic.
//
// Soft delete: isActive = false (no hard delete for MVP).
// Products are tenant-scoped — all queries require tenantId.
// Name uniqueness enforced at DB level (unique index per tenant).
// ============================================================

import mongoose from 'mongoose'
import Product  from '../../models/Product.model.js'
import ApiError from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'
import { checkPlanLimit } from '../../utils/checkPlanLimit.js'

// ── createProduct ─────────────────────────────────────────────

/**
 * Creates a new product scoped to the given tenant.
 * tenantId always comes from req.tenantId (middleware context).
 * cachedHPP is never set here — it remains 0 (model default) until
 * a recipe is saved via productRecipe.service.js.
 *
 * @param {string} tenantId
 * @param {Object} data - validated req.body { name, sellingPrice? }
 * @returns {Promise<Object>} created product
 */
export const createProduct = async (tenantId, data) => {
  // Sprint 2: enforce plan product limit before creating
  await checkPlanLimit(tenantId, 'products')

  try {
    const product = await Product.create({
      tenantId:     new mongoose.Types.ObjectId(tenantId),
      name:         data.name.trim(),
      sellingPrice: data.sellingPrice ?? 0,
    })
    return product.toObject()
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `A product named "${data.name.trim()}" already exists in this tenant`)
    }
    throw err
  }
}

// ── getProducts ───────────────────────────────────────────────

/**
 * Paginated list of products for a tenant.
 * Supports filtering by isActive and name search.
 *
 * @param {string} tenantId
 * @param {Object} queryParams - { page, limit, search, isActive }
 * @returns {Promise<{ products, pagination }>}
 */
export const getProducts = async (tenantId, queryParams) => {
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

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ name: 1 })         // alphabetical — products are reference data
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ])

  return {
    products,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getProductById ────────────────────────────────────────────

/**
 * Fetches a single product by ID, scoped to tenant.
 *
 * @param {string} tenantId
 * @param {string} productId
 * @returns {Promise<Object>} product document
 */
export const getProductById = async (tenantId, productId) => {
  const product = await Product.findOne({
    _id:      new mongoose.Types.ObjectId(productId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).lean()

  if (!product) throw new ApiError(404, 'Product not found')

  return product
}

// ── updateProduct ─────────────────────────────────────────────

/**
 * Updates a product's name, isActive, and/or sellingPrice.
 * tenantId and cachedHPP are immutable here — cachedHPP is written
 * exclusively by productRecipe.service.js → recalculateCachedHPP().
 * This function never touches cachedHPP, by design.
 *
 * @param {string} tenantId
 * @param {string} productId
 * @param {Object} data - { name?, isActive?, sellingPrice? }
 * @returns {Promise<Object>} updated product
 */
export const updateProduct = async (tenantId, productId, data) => {
  const updateData = {}
  if (data.name         !== undefined) updateData.name         = data.name.trim()
  if (data.isActive     !== undefined) updateData.isActive     = data.isActive
  if (data.sellingPrice !== undefined) updateData.sellingPrice = data.sellingPrice

  try {
    const product = await Product.findOneAndUpdate(
      {
        _id:      new mongoose.Types.ObjectId(productId),
        tenantId: new mongoose.Types.ObjectId(tenantId),
      },
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean()

    if (!product) throw new ApiError(404, 'Product not found')

    return product
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `A product named "${data.name?.trim()}" already exists in this tenant`)
    }
    throw err
  }
}

// ── softDeleteProduct ─────────────────────────────────────────

/**
 * Soft-deletes a product by setting isActive = false.
 * Product record is preserved — it may be referenced by
 * existing CupRecord history.
 *
 * @param {string} tenantId
 * @param {string} productId
 * @returns {Promise<void>}
 */
export const softDeleteProduct = async (tenantId, productId) => {
  const product = await Product.findOneAndUpdate(
    {
      _id:      new mongoose.Types.ObjectId(productId),
      tenantId: new mongoose.Types.ObjectId(tenantId),
    },
    { $set: { isActive: false } },
    { new: true }
  ).lean()

  if (!product) throw new ApiError(404, 'Product not found')
}

// ── getProductMargin ──────────────────────────────────────────
// Phase 5c addition.
//
// Computes margin from existing Product fields ONLY — sellingPrice
// and cachedHPP. Does NOT query ProductRecipe; cachedHPP is already
// kept current at write time by productRecipe.service.js, so this
// function has no reason to recalculate or look at recipe items.
//
// Formula (per approved spec):
//   marginAmount      = sellingPrice - cachedHPP
//   marginPercentage  = sellingPrice > 0
//                          ? round((marginAmount / sellingPrice) * 100)
//                          : 0
// Guard against sellingPrice = 0 prevents NaN/Infinity — required.

/**
 * Fetches a product and returns its margin DTO.
 * tenant-scoped, 404 if not found.
 *
 * @param {string} tenantId
 * @param {string} productId
 * @returns {Promise<Object>} margin DTO
 */
export const getProductMargin = async (tenantId, productId) => {
  const product = await Product.findOne({
    _id:      new mongoose.Types.ObjectId(productId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).lean()

  if (!product) throw new ApiError(404, 'Product not found')

  const sellingPrice = product.sellingPrice ?? 0
  const cachedHPP     = product.cachedHPP    ?? 0
  const marginAmount  = sellingPrice - cachedHPP
  const marginPercentage = sellingPrice > 0
    ? Math.round((marginAmount / sellingPrice) * 100)
    : 0

  return {
    productId:        product._id,
    productName:      product.name,
    sellingPrice,
    cachedHPP,
    marginAmount,
    marginPercentage,
  }
}