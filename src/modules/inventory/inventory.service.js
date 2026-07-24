// ============================================================
// modules/inventory/inventory.service.js
// Sprint 6.1 — Cup Inventory & Freshness.
// Sprint 6.2 — Upgraded to real MongoDB session transactions.
//
// Owns all InventoryBatch / InventoryTransaction mutation logic:
//   - FIFO consumption (dispatch/refill)
//   - Freshness/expiry calculation (producedAt-based, never resets)
//   - Crediting returns / debiting rejects back onto the ORIGINAL batch
//     (never creates a new batch for either)
//
// Called exclusively by modules/cup/cup.service.js, always from inside a
// mongoose session transaction (session.withTransaction(...)). EVERY
// exported function that touches the database takes a `session` as its
// first argument and passes it through to every query/write. There is
// no other DB access path into these collections.
//
// Sprint 6.2 note: Sprint 6.1's application-level compensation helpers
// (reverseConsumedBatches, rollbackTransactionsForCupRecord, and the
// insufficient-stock "undo what we just wrote" branch inside consumeFifo)
// have been REMOVED. They are no longer needed — the caller always runs
// these functions inside session.withTransaction(), so any thrown error
// aborts the whole transaction and the driver discards every write made
// under that session automatically. Keeping the old manual rollback code
// alongside real transactions would be a duplicate/dead rollback
// mechanism, which Sprint 6.2 explicitly disallows.
//
// -- Freshness rule (business requirement, unchanged from Sprint 6.1) --
//   ageInDays = floor((now - producedAt) / 1 day)
//   Day 0-1 -> safe   Day 2 -> safe   Day 3 -> warning   Day 4+ -> expired
//   producedAt NEVER changes once a batch is created -- not even when
//   units are returned to it. Age is always computed from the original
//   production date, so a returned cup carries the same freshness it had
//   before it left.
// ============================================================

import mongoose            from 'mongoose'
import InventoryBatch      from '../../models/InventoryBatch.model.js'
import InventoryTransaction from '../../models/InventoryTransaction.model.js'
import Product              from '../../models/Product.model.js'
import Outlet                from '../../models/Outlet.model.js'
import ApiError             from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// Business rule: producedAt age threshold, in days, at which a batch
// becomes permanently unavailable for dispatch/refill.
export const EXPIRY_THRESHOLD_DAYS = 4

// -- Freshness helpers (no DB access -- no session needed) --------

export const getBatchAgeInDays = (producedAt, now = new Date()) => {
  const msPerDay = 1000 * 60 * 60 * 24
  const diff = Math.floor((now.getTime() - new Date(producedAt).getTime()) / msPerDay)
  return Math.max(diff, 0)
}

export const getFreshnessLabel = (producedAt, now = new Date()) => {
  const age = getBatchAgeInDays(producedAt, now)
  if (age <= 1) return 'safe'
  if (age === 2) return 'safe'
  if (age === 3) return 'warning'
  return 'expired'
}

export const isExpiredByAge = (producedAt, now = new Date()) =>
  getBatchAgeInDays(producedAt, now) >= EXPIRY_THRESHOLD_DAYS

// -- FIFO consumption -----------------------------------------

/**
 * MUST be called from inside an active mongoose session transaction
 * (session.withTransaction(...)). Throws ApiError(409) if total active
 * stock is insufficient -- the caller's transaction is expected to abort
 * on this error, so no manual rollback is performed here (Sprint 6.2:
 * the transaction itself discards every write made under `session`).
 *
 * Usability rule (Sprint 6.2 final revision): a batch is usable for FIFO
 * consumption iff `status === 'active'` AND `!isExpiredByAge(producedAt)`.
 * `status` represents inventory LIFECYCLE ONLY (active/depleted) — it is
 * NEVER written to reflect expiry, and is never mutated here or anywhere
 * on a read path. Expiry is purely a computed, point-in-time check.
 */
export const consumeFifo = async (session, { tenantId, outletId, productId, quantity, type, cupRecordId, userId, notes }) => {
  if (!quantity || quantity <= 0) return []

  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const outletOid  = new mongoose.Types.ObjectId(outletId)
  const productOid = new mongoose.Types.ObjectId(productId)
  const now        = new Date()

  const candidateBatches = await InventoryBatch
    .find({
      tenantId:  tenantOid,
      outletId:  outletOid,
      productId: productOid,
      status:    'active',
    })
    .sort({ producedAt: 1, _id: 1 })
    .session(session)

  let remaining = quantity
  const consumed = [] // [{ batchId, quantity }]

  for (const batch of candidateBatches) {
    if (remaining <= 0) break

    // Expiry is computed, never stored/mutated — a batch that has crossed
    // the threshold is simply skipped here, exactly like a depleted one.
    if (batch.status !== 'active' || batch.quantityRemaining <= 0) continue
    if (isExpiredByAge(batch.producedAt, now)) continue

    const take = Math.min(remaining, batch.quantityRemaining)

    const updated = await InventoryBatch.findOneAndUpdate(
      { _id: batch._id, quantityRemaining: { $gte: take }, status: 'active' },
      [
        { $set: { quantityRemaining: { $subtract: ['$quantityRemaining', take] } } },
        { $set: { status: { $cond: [{ $lte: ['$quantityRemaining', 0] }, 'depleted', '$status'] } } },
      ],
      { new: true, session }
    )

    if (!updated) continue

    await InventoryTransaction.create([{
      tenantId:  tenantOid,
      outletId:  outletOid,
      productId: productOid,
      batchId:   batch._id,
      type,
      quantityDelta: -take,
      cupRecordId:   cupRecordId ? new mongoose.Types.ObjectId(cupRecordId) : null,
      createdBy:     new mongoose.Types.ObjectId(userId),
      notes:         notes ?? null,
    }], { session })

    consumed.push({ batchId: batch._id, quantity: take })
    remaining -= take
  }

  if (remaining > 0) {
    throw new ApiError(
      409,
      `Insufficient active inventory for this product at this outlet — short by ${remaining} unit(s).`
    )
  }

  return consumed
}

// -- Return / Reject crediting ---------------------------------

export const applyReturnAndReject = async (session, {
  sourceBatches, returnQty, rejectQty, tenantId, outletId, productId, cupRecordId, userId,
}) => {
  if (!returnQty && !rejectQty) return

  if (!sourceBatches || sourceBatches.length === 0) {
    throw new ApiError(
      409,
      'Cannot process return/reject: this item has no recorded inventory batch source. ' +
      'Return/reject can only be applied to items dispatched/refilled through inventory-tracked batches.'
    )
  }

  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const outletOid  = new mongoose.Types.ObjectId(outletId)
  const productOid = new mongoose.Types.ObjectId(productId)

  let returnRemaining = returnQty
  let rejectRemaining = rejectQty

  for (const entry of sourceBatches) {
    if (returnRemaining <= 0 && rejectRemaining <= 0) break

    let entryCapacity = entry.quantity

    const retFromEntry = Math.min(returnRemaining, entryCapacity)
    returnRemaining -= retFromEntry
    entryCapacity   -= retFromEntry

    const rejFromEntry = Math.min(rejectRemaining, entryCapacity)
    rejectRemaining -= rejFromEntry

    if (retFromEntry > 0) {
      await InventoryTransaction.create([{
        tenantId: tenantOid, outletId: outletOid, productId: productOid,
        batchId: entry.batchId, type: 'return', quantityDelta: retFromEntry,
        cupRecordId: new mongoose.Types.ObjectId(cupRecordId),
        createdBy: new mongoose.Types.ObjectId(userId),
      }], { session })

      await InventoryBatch.updateOne(
        { _id: entry.batchId },
        [
          { $set: { quantityRemaining: { $add: ['$quantityRemaining', retFromEntry] } } },
          { $set: {
              status: {
                $cond: [
                  { $eq: ['$status', 'depleted'] },
                  'active',
                  '$status',
                ],
              },
            },
          },
        ],
        { session }
      )
    }

    if (rejFromEntry > 0) {
      await InventoryTransaction.create([{
        tenantId: tenantOid, outletId: outletOid, productId: productOid,
        batchId: entry.batchId, type: 'reject', quantityDelta: -rejFromEntry,
        cupRecordId: new mongoose.Types.ObjectId(cupRecordId),
        createdBy: new mongoose.Types.ObjectId(userId),
      }], { session })

      await InventoryBatch.updateOne(
        { _id: entry.batchId },
        [
          { $set: { quantityRemaining: { $subtract: ['$quantityRemaining', rejFromEntry] } } },
          { $set: { status: { $cond: [{ $lte: ['$quantityRemaining', 0] }, 'depleted', '$status'] } } },
        ],
        { session }
      )
    }
  }

  if (returnRemaining > 0 || rejectRemaining > 0) {
    throw new ApiError(
      500,
      'Inventory reconciliation failed: recorded batch consumption does not cover the entered return/reject quantities.'
    )
  }
}

// -- Flatten helper (no DB access -- no session needed) --------

export const flattenSourceBatches = (item) => [
  ...((item.dispatchLogs ?? []).flatMap((log) => log.sourceBatches ?? [])),
  ...((item.refillLogs   ?? []).flatMap((log) => log.sourceBatches ?? [])),
]

// ============================================================
// Sprint 6.2 — Production Batch & Inventory Management.
//
// Adds the write path that was missing from Sprint 6.1: creating new
// physical stock (InventoryBatch + a 'production' InventoryTransaction)
// from the application, plus read endpoints to list/inspect batches.
//
// Reuses the existing freshness helpers (getBatchAgeInDays,
// getFreshnessLabel) defined above — no freshness logic is duplicated.
// Does NOT mutate status on read (no lazy expiry sync here) — that only
// happens inside consumeFifo, at the moment a batch is actually
// considered for dispatch/refill, per Sprint 6.1's design. Listing/detail
// here only COMPUTES a freshness label for display; it never writes.
// ============================================================

// ── createProductionBatch ──────────────────────────────────────

/**
 * Creates a new physical production batch: one InventoryBatch +
 * one InventoryTransaction(type='production', quantityDelta=+quantity),
 * inside a single mongoose session transaction (all-or-nothing, same
 * pattern as Sprint 6.2's Cup transactions).
 *
 * Tenant and outlet are derived from the authenticated user's request
 * context (req.tenantId / req.outletId) — never from the request body.
 *
 * @param {string} tenantId
 * @param {string|null} outletId - must be present; null (tenant_admin/
 *   super_admin with no outlet scope) is rejected, since production must
 *   be attributed to a specific outlet and there is no per-request outlet
 *   override in the payload.
 * @param {Object} data - { productId, quantity, producedAt, notes? }
 * @param {string} userId
 */
export const createProductionBatch = async (tenantId, outletId, data, userId) => {
  if (!outletId) {
    throw new ApiError(
      400,
      'Outlet context is required to record production. Sign in with an outlet-scoped account (manager/cashier) or select an outlet.'
    )
  }

  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const outletOid  = new mongoose.Types.ObjectId(outletId)
  const productOid = new mongoose.Types.ObjectId(data.productId)
  const producedAt = new Date(data.producedAt)

  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      const outlet = await Outlet.findOne({
        _id: outletOid, tenantId: tenantOid, isActive: true,
      }).session(session).lean()

      if (!outlet) {
        throw new ApiError(400, 'Invalid or inactive outlet.')
      }

      const product = await Product.findOne({
        _id: productOid, tenantId: tenantOid, isActive: true,
      }).session(session).lean()

      if (!product) {
        throw new ApiError(400, 'Invalid or inactive product.')
      }

      const created = await InventoryBatch.create([{
        tenantId:          tenantOid,
        outletId:          outletOid,
        productId:         productOid,
        producedAt,
        quantityInitial:   data.quantity,
        quantityRemaining: data.quantity,
        status:            'active',
      }], { session })

      const batch = created[0]

      await InventoryTransaction.create([{
        tenantId:      tenantOid,
        outletId:      outletOid,
        productId:     productOid,
        batchId:       batch._id,
        type:          'production',
        quantityDelta: data.quantity,
        cupRecordId:   null,
        createdBy:     new mongoose.Types.ObjectId(userId),
        notes:         data.notes?.trim() || null,
      }], { session })

      result = batch.toObject()
    })
  } finally {
    await session.endSession()
  }

  return withFreshness(result)
}

// ── Shared helpers (Sprint 6.3 — extracted to avoid duplicating the
//    outlet-scope and freshness-annotation logic across every read
//    endpoint) ──────────────────────────────────────────────────

/**
 * Builds the tenant(+outlet) portion of a query filter, honoring the same
 * outlet-scope rule everywhere in this module: `outletId` (req.outletId,
 * set by tenantGuard) is ALWAYS enforced when present (manager/cashier/
 * viewer); when null (super_admin/tenant_admin), an optional
 * `queryOutletId` filter may narrow the cross-outlet view. No role name
 * is ever checked — tenantGuard's existing output is the sole signal.
 */
const buildTenantOutletFilter = (tenantId, outletId, queryOutletId) => {
  const filter = { tenantId: new mongoose.Types.ObjectId(tenantId) }

  if (outletId) {
    filter.outletId = new mongoose.Types.ObjectId(outletId)
  } else if (queryOutletId) {
    filter.outletId = new mongoose.Types.ObjectId(queryOutletId)
  }

  return filter
}

/**
 * Annotates a plain InventoryBatch object with computed ageInDays/
 * freshness — reuses getBatchAgeInDays/getFreshnessLabel, never
 * duplicates the threshold logic, never mutates the source object's
 * `status`.
 */
const withFreshness = (batch) => ({
  ...batch,
  ageInDays: getBatchAgeInDays(batch.producedAt),
  freshness: getFreshnessLabel(batch.producedAt),
})

/**
 * Paginated list of InventoryBatch documents, each annotated with
 * ageInDays / freshness (computed, not stored) alongside the batch's own
 * quantityRemaining and status. Read-only — never mutates status.
 *
 * Outlet scope (Sprint 6.2 final revision): `outletId` is the value
 * tenantGuard already put on req.outletId — null for super_admin/
 * tenant_admin (who may browse across outlets, optionally narrowed by
 * queryParams.outletId), and a specific outlet id for every other role
 * (manager/cashier/viewer), which is then ALWAYS enforced regardless of
 * what queryParams.outletId says — no role name is checked here, the
 * existing tenantGuard-provided value is the sole source of truth.
 *
 * Filters: productId, status (always optional); outletId (see above).
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId (null = unscoped/admin)
 * @param {Object} queryParams
 */
export const listBatches = async (tenantId, outletId, queryParams = {}) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = buildTenantOutletFilter(tenantId, outletId, queryParams.outletId)

  if (queryParams.productId) filter.productId = new mongoose.Types.ObjectId(queryParams.productId)
  if (queryParams.status)    filter.status    = queryParams.status

  const [batches, total] = await Promise.all([
    InventoryBatch.find(filter).sort({ producedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    InventoryBatch.countDocuments(filter),
  ])

  return {
    batches: batches.map(withFreshness),
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getBatchById ───────────────────────────────────────────────

/**
 * Single InventoryBatch by id, annotated with ageInDays/freshness.
 * Read-only — never mutates status.
 *
 * Outlet scope: same rule as listBatches — outletId (req.outletId) is
 * enforced when present (manager/cashier/viewer), unrestricted when null
 * (super_admin/tenant_admin).
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId (null = unscoped/admin)
 * @param {string} batchId
 */
export const getBatchById = async (tenantId, outletId, batchId) => {
  const filter = {
    _id:      new mongoose.Types.ObjectId(batchId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }

  if (outletId) {
    filter.outletId = new mongoose.Types.ObjectId(outletId)
  }

  const batch = await InventoryBatch.findOne(filter).lean()

  if (!batch) {
    throw new ApiError(404, 'Inventory batch not found')
  }

  return withFreshness(batch)
}

// ============================================================
// Sprint 6.3 — Inventory Management APIs (read-only).
//
// All five functions below reuse buildTenantOutletFilter/withFreshness
// (defined above) for outlet-scoping and freshness annotation — no
// duplicate logic, no new expiry/freshness math. None of them mutate
// anything; they only ever read.
// ============================================================

// ── getInventoryDashboard ─────────────────────────────────────
// GET /inventory/dashboard

/**
 * Tenant/outlet-scoped inventory summary: batch counts by lifecycle
 * status, total units remaining, a freshness breakdown (computed via the
 * existing helper, never duplicated), and recent (last 7 days)
 * transaction activity grouped by type.
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId
 * @param {Object} queryParams   - optional { outletId } (admin tiers only)
 */
export const getInventoryDashboard = async (tenantId, outletId, queryParams = {}) => {
  const filter = buildTenantOutletFilter(tenantId, outletId, queryParams.outletId)

  const [statusSummary] = await InventoryBatch.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalBatches:        { $sum: 1 },
        activeBatches:       { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        depletedBatches:     { $sum: { $cond: [{ $eq: ['$status', 'depleted'] }, 1, 0] } },
        totalUnitsRemaining: { $sum: '$quantityRemaining' },
      },
    },
  ])

  // Freshness breakdown — only active batches with usable stock are
  // relevant (a depleted batch always has 0 remaining). Computed in JS
  // via the existing helper, not duplicated as Mongo date-math.
  const activeStockBatches = await InventoryBatch
    .find({ ...filter, status: 'active', quantityRemaining: { $gt: 0 } })
    .select('producedAt')
    .lean()

  const freshnessBreakdown = { safe: 0, warning: 0, expired: 0 }
  for (const batch of activeStockBatches) {
    const label = getFreshnessLabel(batch.producedAt)
    freshnessBreakdown[label] = (freshnessBreakdown[label] ?? 0) + 1
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const transactionActivity = await InventoryTransaction.aggregate([
    { $match: { ...filter, createdAt: { $gte: sevenDaysAgo } } },
    {
      $group: {
        _id:           '$type',
        count:         { $sum: 1 },
        totalQuantity: { $sum: { $abs: '$quantityDelta' } },
      },
    },
    { $sort: { _id: 1 } },
  ])

  return {
    totalBatches:        statusSummary?.totalBatches ?? 0,
    activeBatches:        statusSummary?.activeBatches ?? 0,
    depletedBatches:      statusSummary?.depletedBatches ?? 0,
    totalUnitsRemaining:  statusSummary?.totalUnitsRemaining ?? 0,
    freshnessBreakdown,
    recentActivity: {
      sinceDate: sevenDaysAgo,
      byType: transactionActivity.map((t) => ({
        type: t._id, count: t.count, totalQuantity: t.totalQuantity,
      })),
    },
  }
}

// ── getInventoryOverview ──────────────────────────────────────
// GET /inventory

/**
 * Paginated, searchable, sortable per-PRODUCT stock summary — rolls up
 * every batch of a product (within outlet scope) into one row: total
 * remaining, batch counts, oldest/newest producedAt, and a freshness
 * breakdown for that product's currently-active stock.
 *
 * Search: by product name (case-insensitive substring).
 * Sort: 'name' | 'remaining' (default) | 'oldest'; order 'asc'|'desc' (default desc).
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId
 * @param {Object} queryParams   - { search?, sort?, order?, outletId?, page?, limit? }
 */
export const getInventoryOverview = async (tenantId, outletId, queryParams = {}) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)
  const filter = buildTenantOutletFilter(tenantId, outletId, queryParams.outletId)

  if (queryParams.search) {
    const matchingProducts = await Product
      .find({ tenantId: filter.tenantId, name: { $regex: queryParams.search, $options: 'i' } })
      .select('_id')
      .lean()

    filter.productId = { $in: matchingProducts.map((p) => p._id) }
  }

  const sortKey = { name: 'productName', oldest: 'oldestProducedAt' }[queryParams.sort] || 'totalRemaining'
  const sortOrder = queryParams.order === 'asc' ? 1 : -1

  const [result] = await InventoryBatch.aggregate([
    { $match: filter },
    {
      $group: {
        _id:               '$productId',
        totalRemaining:     { $sum: '$quantityRemaining' },
        batchCount:         { $sum: 1 },
        activeBatchCount:   { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        depletedBatchCount: { $sum: { $cond: [{ $eq: ['$status', 'depleted'] }, 1, 0] } },
        oldestProducedAt:   { $min: '$producedAt' },
        newestProducedAt:   { $max: '$producedAt' },
      },
    },
    {
      $lookup: {
        from:         Product.collection.name,
        localField:   '_id',
        foreignField: '_id',
        as:           'product',
      },
    },
    { $unwind: '$product' },
    {
      $project: {
        _id:                0,
        productId:          '$_id',
        productName:        '$product.name',
        productIsActive:    '$product.isActive',
        totalRemaining:     1,
        batchCount:         1,
        activeBatchCount:   1,
        depletedBatchCount: 1,
        oldestProducedAt:   1,
        newestProducedAt:   1,
      },
    },
    { $sort: { [sortKey]: sortOrder, productId: 1 } },
    {
      $facet: {
        data:       [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ])

  const rows  = result?.data ?? []
  const total = result?.totalCount?.[0]?.count ?? 0

  // Freshness breakdown per product, scoped to THIS PAGE's products only
  // — reuses the existing helper, computed in JS, not duplicated.
  const productIds = rows.map((r) => r.productId)
  const activeStockBatches = await InventoryBatch
    .find({ ...filter, productId: { $in: productIds }, status: 'active', quantityRemaining: { $gt: 0 } })
    .select('productId producedAt')
    .lean()

  const freshnessByProduct = new Map()
  for (const batch of activeStockBatches) {
    const key = batch.productId.toString()
    const label = getFreshnessLabel(batch.producedAt)
    const bucket = freshnessByProduct.get(key) ?? { safe: 0, warning: 0, expired: 0 }
    bucket[label] += 1
    freshnessByProduct.set(key, bucket)
  }

  const products = rows.map((row) => ({
    ...row,
    oldestAgeInDays:    getBatchAgeInDays(row.oldestProducedAt),
    freshnessBreakdown: freshnessByProduct.get(row.productId.toString()) ?? { safe: 0, warning: 0, expired: 0 },
  }))

  return {
    products,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getProductInventoryDetail ─────────────────────────────────
// GET /inventory/products/:productId

/**
 * Single product's inventory detail: summary totals + a paginated list
 * of its individual batches (each annotated with freshness).
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId
 * @param {string} productId
 * @param {Object} queryParams   - { outletId?, page?, limit? }
 */
export const getProductInventoryDetail = async (tenantId, outletId, productId, queryParams = {}) => {
  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const productOid = new mongoose.Types.ObjectId(productId)

  const product = await Product.findOne({ _id: productOid, tenantId: tenantOid }).lean()
  if (!product) {
    throw new ApiError(404, 'Product not found')
  }

  const { page, limit, skip } = buildPaginationQuery(queryParams)
  const filter = buildTenantOutletFilter(tenantId, outletId, queryParams.outletId)
  filter.productId = productOid

  const [batches, total, summaryResult] = await Promise.all([
    InventoryBatch.find(filter).sort({ producedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    InventoryBatch.countDocuments(filter),
    InventoryBatch.aggregate([
      { $match: filter },
      {
        $group: {
          _id:                null,
          totalRemaining:      { $sum: '$quantityRemaining' },
          activeBatchCount:    { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          depletedBatchCount:  { $sum: { $cond: [{ $eq: ['$status', 'depleted'] }, 1, 0] } },
        },
      },
    ]),
  ])

  return {
    product: { _id: product._id, name: product.name, isActive: product.isActive },
    summary: {
      totalRemaining:     summaryResult[0]?.totalRemaining ?? 0,
      activeBatchCount:   summaryResult[0]?.activeBatchCount ?? 0,
      depletedBatchCount: summaryResult[0]?.depletedBatchCount ?? 0,
    },
    batches: batches.map(withFreshness),
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── listTransactions ──────────────────────────────────────────
// GET /inventory/transactions

/**
 * Paginated, filterable, sortable InventoryTransaction ledger across the
 * tenant (outlet-scoped per the same rule as everything else in this
 * module). Includes the product name via $lookup for readability.
 *
 * Filters: type, productId, batchId, dateFrom, dateTo, search (notes
 * substring, case-insensitive).
 * Sort: 'quantity' | 'createdAt' (default); order 'asc'|'desc' (default desc).
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId
 * @param {Object} queryParams
 */
export const listTransactions = async (tenantId, outletId, queryParams = {}) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)
  const filter = buildTenantOutletFilter(tenantId, outletId, queryParams.outletId)

  if (queryParams.type)      filter.type      = queryParams.type
  if (queryParams.productId) filter.productId = new mongoose.Types.ObjectId(queryParams.productId)
  if (queryParams.batchId)   filter.batchId   = new mongoose.Types.ObjectId(queryParams.batchId)

  if (queryParams.dateFrom || queryParams.dateTo) {
    filter.createdAt = {}
    if (queryParams.dateFrom) filter.createdAt.$gte = new Date(queryParams.dateFrom)
    if (queryParams.dateTo)   filter.createdAt.$lte = new Date(queryParams.dateTo)
  }

  if (queryParams.search) {
    filter.notes = { $regex: queryParams.search, $options: 'i' }
  }

  const sortField = queryParams.sort === 'quantity' ? 'quantityDelta' : 'createdAt'
  const sortOrder = queryParams.order === 'asc' ? 1 : -1

  const [result] = await InventoryTransaction.aggregate([
    { $match: filter },
    { $sort: { [sortField]: sortOrder, _id: sortOrder } },
    {
      $lookup: {
        from:         Product.collection.name,
        localField:   'productId',
        foreignField: '_id',
        as:           'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        tenantId: 1, outletId: 1, productId: 1, batchId: 1, type: 1,
        quantityDelta: 1, cupRecordId: 1, createdBy: 1, createdAt: 1, notes: 1,
        productName: '$product.name',
      },
    },
    {
      $facet: {
        data:       [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ])

  return {
    transactions: result?.data ?? [],
    pagination: buildPaginationMeta({ total: result?.totalCount?.[0]?.count ?? 0, page, limit }),
  }
}

// ── listBatchTransactions ─────────────────────────────────────
// GET /inventory/batches/:batchId/transactions

/**
 * The complete movement ledger for ONE batch — "show me everything that
 * happened to Batch A" — sorted chronologically (oldest first) by
 * default, matching how a ledger is naturally read.
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId
 * @param {string} batchId
 * @param {Object} queryParams   - { type?, order?, page?, limit? }
 */
export const listBatchTransactions = async (tenantId, outletId, batchId, queryParams = {}) => {
  const batchFilter = {
    _id:      new mongoose.Types.ObjectId(batchId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }
  if (outletId) batchFilter.outletId = new mongoose.Types.ObjectId(outletId)

  const batch = await InventoryBatch.findOne(batchFilter).lean()
  if (!batch) {
    throw new ApiError(404, 'Inventory batch not found')
  }

  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = { tenantId: batchFilter.tenantId, batchId: batch._id }
  if (queryParams.type) filter.type = queryParams.type

  const sortOrder = queryParams.order === 'desc' ? -1 : 1 // chronological (oldest first) by default

  const [transactions, total] = await Promise.all([
    InventoryTransaction.find(filter).sort({ createdAt: sortOrder, _id: sortOrder }).skip(skip).limit(limit).lean(),
    InventoryTransaction.countDocuments(filter),
  ])

  return {
    batch: withFreshness(batch),
    transactions,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}