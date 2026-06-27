// ============================================================
// modules/productRecipe/productRecipe.service.js
// All product recipe business logic, including the HPP
// recalculation that writes back to Product.cachedHPP.
//
// ARCHITECTURE DECISION (approved):
//   recalculateCachedHPP() lives HERE, not in product.service.js.
//   This module owns the cost calculation and writes its result
//   onto Product directly — product.service.js is never modified
//   for this purpose and has no knowledge of recipes or HPP.
//   This mirrors payroll.service.js owning bonus calculations
//   that get written onto Payroll, not split across modules.
//
// Cross-reference checks done here (not in validation layer):
//   - productId must exist in this tenant
//   - every rawMaterialId must exist in this SAME tenant
//     (prevents cross-tenant material reference)
// ============================================================

import mongoose      from 'mongoose'
import ProductRecipe from '../../models/ProductRecipe.model.js'
import Product       from '../../models/Product.model.js'
import RawMaterial   from '../../models/RawMaterial.model.js'
import ApiError      from '../../utils/ApiError.js'

// ── recalculateCachedHPP ──────────────────────────────────────

/**
 * Recomputes and writes Product.cachedHPP from the current recipe.
 *
 * cachedHPP = SUM( item.quantityUsed × rawMaterial.costPerUnit )
 * Rounded to the nearest whole currency unit (IDR has no
 * fractional subunit in practice).
 *
 * Called after every successful recipe PUT.
 * For DELETE, the caller resets cachedHPP to 0 directly instead
 * of calling this function (no items left to sum).
 *
 * KNOWN MVP LIMITATION (documented, accepted — not solved here):
 *   If a RawMaterial.costPerUnit changes AFTER this calculation
 *   runs, cachedHPP becomes stale until the recipe is next saved
 *   via PUT. rawMaterial.service.js is intentionally not modified
 *   to push recalculation on cost change — see Phase 5b architecture
 *   review for the accepted tradeoff.
 *
 * @param {string} tenantId
 * @param {string} productId
 * @param {Array}  items - [{ rawMaterialId, quantityUsed }]
 * @returns {Promise<number>} the calculated cachedHPP value
 */
const recalculateCachedHPP = async (tenantId, productId, items) => {
  const rawMaterialIds = items.map((i) => i.rawMaterialId)

  const rawMaterials = await RawMaterial.find({
    _id:      { $in: rawMaterialIds },
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).lean()

  const costMap = new Map(
    rawMaterials.map((m) => [m._id.toString(), m.costPerUnit])
  )

  let cachedHPP = 0
  for (const item of items) {
    const costPerUnit = costMap.get(item.rawMaterialId.toString())
    // costPerUnit is guaranteed defined here — existence already
    // verified by the caller (upsertRecipe) before this is invoked.
    cachedHPP += item.quantityUsed * costPerUnit
  }

  cachedHPP = Math.round(cachedHPP)

  await Product.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(productId), tenantId: new mongoose.Types.ObjectId(tenantId) },
    { $set: { cachedHPP } }
  )

  return cachedHPP
}

// ── getRecipe ──────────────────────────────────────────────────

/**
 * Fetches the recipe for a product, scoped to tenant.
 *
 * @param {string} tenantId
 * @param {string} productId
 * @returns {Promise<Object>} recipe document
 */
export const getRecipe = async (tenantId, productId) => {
  const recipe = await ProductRecipe.findOne({
    productId: new mongoose.Types.ObjectId(productId),
    tenantId:  new mongoose.Types.ObjectId(tenantId),
  }).lean()

  if (!recipe) throw new ApiError(404, 'No recipe found for this product')

  return recipe
}

// ── upsertRecipe ───────────────────────────────────────────────

/**
 * Creates or fully replaces the recipe for a product (idempotent PUT).
 * Validates productId exists and every rawMaterialId exists in the
 * same tenant BEFORE writing anything — no partial saves.
 *
 * @param {string} tenantId
 * @param {string} productId
 * @param {Array}  items - validated [{ rawMaterialId, quantityUsed }]
 * @returns {Promise<{ recipe: Object, isNew: boolean }>}
 */
export const upsertRecipe = async (tenantId, productId, items) => {
  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const productOid = new mongoose.Types.ObjectId(productId)

  // ── Verify product exists in this tenant ──────────────────
  const product = await Product.findOne({ _id: productOid, tenantId: tenantOid }).lean()
  if (!product) {
    throw new ApiError(404, 'Product not found')
  }

  // ── Verify every rawMaterialId exists in this SAME tenant ──
  const rawMaterialIds = items.map((i) => new mongoose.Types.ObjectId(i.rawMaterialId))

  const foundMaterials = await RawMaterial.find({
    _id:      { $in: rawMaterialIds },
    tenantId: tenantOid,
  }).lean()

  if (foundMaterials.length !== rawMaterialIds.length) {
    const foundIds   = new Set(foundMaterials.map((m) => m._id.toString()))
    const missingIds = items
      .map((i) => i.rawMaterialId)
      .filter((id) => !foundIds.has(id))

    throw new ApiError(
      404,
      `The following rawMaterialId(s) were not found in this tenant: ${missingIds.join(', ')}`
    )
  }

  // ── Check if recipe already exists (to report 201 vs 200) ──
  const existing = await ProductRecipe.findOne({ productId: productOid, tenantId: tenantOid }).lean()
  const isNew     = !existing

  const normalizedItems = items.map((i) => ({
    rawMaterialId: new mongoose.Types.ObjectId(i.rawMaterialId),
    quantityUsed:  i.quantityUsed,
  }))

  const recipe = await ProductRecipe.findOneAndUpdate(
    { productId: productOid, tenantId: tenantOid },
    { $set: { items: normalizedItems } },
    { new: true, upsert: true, runValidators: true }
  ).lean()

  // ── Recalculate and persist cachedHPP on the Product ───────
  await recalculateCachedHPP(tenantId, productId, normalizedItems)

  return { recipe, isNew }
}

// ── deleteRecipe ───────────────────────────────────────────────

/**
 * Removes the recipe for a product entirely and resets
 * Product.cachedHPP to 0 (no recipe = no known cost).
 *
 * @param {string} tenantId
 * @param {string} productId
 * @returns {Promise<void>}
 */
export const deleteRecipe = async (tenantId, productId) => {
  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const productOid = new mongoose.Types.ObjectId(productId)

  const recipe = await ProductRecipe.findOneAndDelete({
    productId: productOid,
    tenantId:  tenantOid,
  }).lean()

  if (!recipe) throw new ApiError(404, 'No recipe found for this product')

  // Reset cachedHPP directly — no items left to sum.
  await Product.findOneAndUpdate(
    { _id: productOid, tenantId: tenantOid },
    { $set: { cachedHPP: 0 } }
  )
}