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
 * Sprint 7.6 — API response enrichment (no business logic change).
 *
 * Attaches populated `product: {_id, name}` / `outlet: {_id, name}`
 * objects to a plain document that already has raw `productId`/
 * `outletId` fields — WITHOUT removing those raw fields, so existing
 * consumers of productId/outletId keep working unchanged (backward
 * compatible, purely additive).
 *
 * Written ONCE and reused by every endpoint that needs this (getBatchById,
 * listBatchTransactions, getAdjustmentById) — per "avoid duplicate lookup
 * logic." Reuses the existing Product/Outlet models directly; no new
 * models, no schema changes.
 *
 * @param {Object} doc - plain object with productId/outletId fields
 * @returns {Promise<Object>} doc with `product`/`outlet` added
 */
const enrichWithProductAndOutlet = async (doc) => {
  const [product, outlet] = await Promise.all([
    doc.productId ? Product.findById(doc.productId).select('name').lean() : null,
    doc.outletId  ? Outlet.findById(doc.outletId).select('name').lean()   : null,
  ])

  return {
    ...doc,
    product: product ? { _id: product._id, name: product.name } : null,
    outlet:  outlet  ? { _id: outlet._id,  name: outlet.name }   : null,
  }
}

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

  return enrichWithProductAndOutlet(withFreshness(batch))
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

  // Sprint 6.4 — today / this-month adjustment activity, grouped by
  // reason. Both use the same shared aggregation shape (extracted to
  // groupAdjustmentsSince below) to avoid writing the same $group twice.
  const now          = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [todayAdjustmentByReason, monthAdjustmentByReason] = await Promise.all([
    groupAdjustmentsSince(filter, startOfToday),
    groupAdjustmentsSince(filter, startOfMonth),
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
    todayAdjustment: {
      sinceDate: startOfToday,
      byReason:  todayAdjustmentByReason,
    },
    monthAdjustment: {
      sinceDate: startOfMonth,
      byReason:  monthAdjustmentByReason,
    },
  }
}

/**
 * Shared aggregation shape for "adjustment transactions since date X,
 * grouped by reason" — used for both todayAdjustment and monthAdjustment
 * in getInventoryDashboard so the $group pipeline isn't written twice.
 *
 * @param {Object} tenantOutletFilter - already-built filter from buildTenantOutletFilter
 * @param {Date} sinceDate
 */
const groupAdjustmentsSince = async (tenantOutletFilter, sinceDate) => {
  const grouped = await InventoryTransaction.aggregate([
    { $match: { ...tenantOutletFilter, type: 'adjustment', createdAt: { $gte: sinceDate } } },
    {
      $group: {
        _id:                '$reason',
        count:               { $sum: 1 },
        totalQuantityDelta:  { $sum: '$quantityDelta' },
      },
    },
    { $sort: { _id: 1 } },
  ])

  return grouped.map((g) => ({
    reason: g._id, count: g.count, totalQuantityDelta: g.totalQuantityDelta,
  }))
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
 * module). Includes populated `product`/`outlet` objects via $lookup —
 * Sprint 7.6 enrichment, additive only (existing `productId`/`outletId`/
 * `productName` fields are all still present, unchanged).
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
  // Sprint 8.2 — optional multi-product filter (e.g. Production's
  // product-name search resolves to a set of matching productIds).
  // Additive: only applied if provided; takes precedence over the single
  // productId above when both happen to be present. No existing caller
  // (listAdjustments, the general /inventory/transactions route) sends
  // this, so their behavior is unchanged.
  if (queryParams.productIds && queryParams.productIds.length > 0) {
    filter.productId = { $in: queryParams.productIds }
  }
  if (queryParams.batchId)   filter.batchId   = new mongoose.Types.ObjectId(queryParams.batchId)
  // Sprint 6.4 — only meaningful for type='adjustment', but harmless as a
  // general filter (non-adjustment documents simply have reason: null and
  // won't match a non-null reason filter).
  if (queryParams.reason)    filter.reason    = queryParams.reason

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
    // Sprint 7.6 — reuses the existing Outlet model via the same $lookup
    // pattern already established above for Product; no duplicate lookup
    // implementation, just the same technique applied to a second collection.
    {
      $lookup: {
        from:         Outlet.collection.name,
        localField:   'outletId',
        foreignField: '_id',
        as:           'outlet',
      },
    },
    { $unwind: { path: '$outlet', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        tenantId: 1, outletId: 1, productId: 1, batchId: 1, type: 1,
        quantityDelta: 1, cupRecordId: 1, createdBy: 1, createdAt: 1, notes: 1,
        reason: 1, beforeQuantity: 1, afterQuantity: 1,
        // Kept for backward compatibility (Sprint 7.2 field) —
        productName: '$product.name',
        // Sprint 7.6 — populated objects, null when not found (matches
        // enrichWithProductAndOutlet's null-when-missing behavior).
        product: {
          $cond: [{ $ifNull: ['$product', false] }, { _id: '$product._id', name: '$product.name' }, null],
        },
        outlet: {
          $cond: [{ $ifNull: ['$outlet', false] }, { _id: '$outlet._id', name: '$outlet.name' }, null],
        },
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

  // Sprint 7.6 — enrich ONCE using the batch's own productId/outletId
  // (every transaction in this list is scoped to this single batch, so
  // they all share the same product/outlet — attaching the same already-
  // fetched {product, outlet} to each avoids N duplicate lookups for one
  // response).
  const enrichedBatch = await enrichWithProductAndOutlet(withFreshness(batch))
  const enrichedTransactions = transactions.map((txn) => ({
    ...txn,
    product: enrichedBatch.product,
    outlet:  enrichedBatch.outlet,
  }))

  return {
    batch: enrichedBatch,
    transactions: enrichedTransactions,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ============================================================
// Sprint 6.4 — Inventory Adjustment & Stock Opname.
//
// InventoryBatch remains lifecycle-only: nothing below ever edits
// quantityRemaining/status directly outside of the same $set-from-
// InventoryTransaction pattern already used by consumeFifo/
// applyReturnAndReject. There is still no PATCH/PUT on InventoryBatch —
// every mutation is the side-effect of writing an InventoryTransaction
// first, inside the same session transaction.
// ============================================================

// ── applyAdjustmentToBatch (shared core — used by BOTH manual
//    adjustment and stock opname, so the write logic exists in exactly
//    one place) ──────────────────────────────────────────────

/**
 * Applies one signed quantity adjustment to ONE batch: writes the
 * InventoryTransaction(type='adjustment') first, then updates
 * InventoryBatch.quantityRemaining/status as a direct consequence of
 * that transaction — same pattern as every other movement type in this
 * module. MUST be called from inside an active session transaction.
 *
 * Throws ApiError(400) if the adjustment would drive quantityRemaining
 * negative (a batch can never hold negative stock).
 *
 * @param {import('mongoose').ClientSession} session
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.outletId
 * @param {string} params.productId
 * @param {string} params.batchId
 * @param {number} params.quantityDelta - signed, non-zero
 * @param {string} params.reason
 * @param {string} [params.notes]
 * @param {string} params.userId
 * @returns {Promise<Object>} the created InventoryTransaction (plain object)
 */
const applyAdjustmentToBatch = async (session, {
  tenantId, outletId, productId, batchId, quantityDelta, reason, notes, userId,
}) => {
  const batch = await InventoryBatch.findOne({
    _id: batchId, tenantId: new mongoose.Types.ObjectId(tenantId),
  }).session(session)

  if (!batch) {
    throw new ApiError(404, `Inventory batch ${batchId} not found`)
  }

  const beforeQuantity = batch.quantityRemaining
  const afterQuantity  = beforeQuantity + quantityDelta

  if (afterQuantity < 0) {
    throw new ApiError(
      400,
      `Adjustment would result in a negative remaining quantity for batch ${batchId} ` +
      `(before: ${beforeQuantity}, delta: ${quantityDelta}).`
    )
  }

  // InventoryBatch stays lifecycle-only: status is simply re-derived from
  // the new quantity (active if >0, depleted if 0) — never touched by
  // anything expiry-related, exactly like every other movement type.
  await InventoryBatch.updateOne(
    { _id: batch._id },
    [
      { $set: { quantityRemaining: { $add: ['$quantityRemaining', quantityDelta] } } },
      { $set: { status: { $cond: [{ $lte: ['$quantityRemaining', 0] }, 'depleted', 'active'] } } },
    ],
    { session }
  )

  const created = await InventoryTransaction.create([{
    tenantId:      new mongoose.Types.ObjectId(tenantId),
    outletId:      new mongoose.Types.ObjectId(outletId),
    productId:     new mongoose.Types.ObjectId(productId),
    batchId:       batch._id,
    type:          'adjustment',
    quantityDelta,
    cupRecordId:   null,
    createdBy:     new mongoose.Types.ObjectId(userId),
    reason,
    beforeQuantity,
    afterQuantity,
    notes: notes?.trim() || null,
  }], { session })

  return created[0].toObject()
}

// ── createAdjustment ──────────────────────────────────────────
// POST /inventory/adjustment

/**
 * Manual, single-batch adjustment (e.g. damage, loss, count correction).
 * Runs inside a session transaction — the InventoryTransaction write and
 * the InventoryBatch quantity/status update commit or abort together.
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId, enforced as the batch's
 *   required scope when present (manager/cashier), unrestricted when null
 *   (super_admin/tenant_admin may adjust any outlet's batch).
 * @param {Object} data - { batchId, quantityDelta, reason, notes? }
 * @param {string} userId
 */
export const createAdjustment = async (tenantId, outletId, data, userId) => {
  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      const batchOid = new mongoose.Types.ObjectId(data.batchId)
      const scopeFilter = { _id: batchOid, tenantId: new mongoose.Types.ObjectId(tenantId) }
      if (outletId) scopeFilter.outletId = new mongoose.Types.ObjectId(outletId)

      const batch = await InventoryBatch.findOne(scopeFilter).session(session).lean()
      if (!batch) {
        throw new ApiError(404, 'Inventory batch not found')
      }

      result = await applyAdjustmentToBatch(session, {
        tenantId, outletId: batch.outletId, productId: batch.productId, batchId: batch._id,
        quantityDelta: data.quantityDelta, reason: data.reason, notes: data.notes, userId,
      })
    })
  } finally {
    await session.endSession()
  }

  return result
}

// ── performStockOpname ────────────────────────────────────────
// POST /inventory/opname

/**
 * Compares a physically counted quantity against the current system
 * total (sum of quantityRemaining across ALL of this product's batches
 * at the outlet — active or depleted, since a physical recount corrects
 * reality regardless of a batch's lifecycle state) and automatically
 * creates the adjustment transaction(s) needed to reconcile the
 * difference, reason='stock_opname' (reserved — never settable via
 * createAdjustment directly).
 *
 * Attribution rule (a physical count can't say which exact batch changed,
 * so a reasonable default is applied):
 *   - Shortage (physicalQty < systemQty): debited oldest-batch-first
 *     (mirrors FIFO physical handling — oldest stock is assumed consumed/
 *     lost first), possibly spanning multiple batches → multiple
 *     transactions.
 *   - Surplus (physicalQty > systemQty): credited entirely to the most
 *     recently produced batch. Requires at least one existing batch for
 *     this product/outlet — a surplus with zero batches on record cannot
 *     be attributed to any producedAt and is rejected (record a
 *     production batch first).
 *
 * Runs inside ONE session transaction — all resulting adjustment
 * transactions commit or abort together.
 *
 * @param {string} tenantId
 * @param {string|null} outletId - req.outletId; MUST be present (opname is
 *   always outlet-scoped — there is no cross-outlet physical count).
 * @param {Object} data - { productId, physicalQty, notes? }
 * @param {string} userId
 */
export const performStockOpname = async (tenantId, outletId, data, userId) => {
  if (!outletId) {
    throw new ApiError(
      400,
      'Outlet context is required to perform a stock opname. Sign in with an outlet-scoped account (manager/cashier) or select an outlet.'
    )
  }

  const tenantOid  = new mongoose.Types.ObjectId(tenantId)
  const outletOid  = new mongoose.Types.ObjectId(outletId)
  const productOid = new mongoose.Types.ObjectId(data.productId)

  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      const product = await Product.findOne({ _id: productOid, tenantId: tenantOid }).session(session).lean()
      if (!product) {
        throw new ApiError(400, 'Invalid product.')
      }

      const batches = await InventoryBatch
        .find({ tenantId: tenantOid, outletId: outletOid, productId: productOid })
        .sort({ producedAt: 1, _id: 1 })
        .session(session)

      const systemQty = batches.reduce((sum, b) => sum + b.quantityRemaining, 0)
      const delta      = data.physicalQty - systemQty

      if (delta === 0) {
        result = { systemQty, physicalQty: data.physicalQty, delta: 0, transactions: [] }
        return
      }

      const transactions = []

      if (delta > 0) {
        if (batches.length === 0) {
          throw new ApiError(
            400,
            'Cannot record a stock opname surplus — no existing batch for this product at this outlet. Record production first.'
          )
        }
        const newestBatch = batches[batches.length - 1]
        const txn = await applyAdjustmentToBatch(session, {
          tenantId, outletId: outletOid, productId: productOid, batchId: newestBatch._id,
          quantityDelta: delta, reason: 'stock_opname', notes: data.notes, userId,
        })
        transactions.push(txn)
      } else {
        let remainingToRemove = -delta // positive magnitude
        for (const batch of batches) {
          if (remainingToRemove <= 0) break
          const take = Math.min(remainingToRemove, batch.quantityRemaining)
          if (take <= 0) continue

          const txn = await applyAdjustmentToBatch(session, {
            tenantId, outletId: outletOid, productId: productOid, batchId: batch._id,
            quantityDelta: -take, reason: 'stock_opname', notes: data.notes, userId,
          })
          transactions.push(txn)
          remainingToRemove -= take
        }
        // remainingToRemove cannot exceed 0 here by construction: |delta|
        // is bounded by systemQty (physicalQty >= 0), which is exactly the
        // sum of every batch's quantityRemaining walked above.
      }

      result = { systemQty, physicalQty: data.physicalQty, delta, transactions }
    })
  } finally {
    await session.endSession()
  }

  return result
}

// ── listAdjustments ───────────────────────────────────────────
// GET /inventory/adjustments
//
// Thin wrapper over listTransactions — reuses its filtering, search,
// sorting, pagination, and product-name $lookup entirely; only forces
// type='adjustment' (query-supplied `type` is ignored/overridden, since
// this endpoint is adjustment-only by definition). No logic duplicated.

export const listAdjustments = (tenantId, outletId, queryParams = {}) =>
  listTransactions(tenantId, outletId, { ...queryParams, type: 'adjustment' })

// ── getTransactionById ────────────────────────────────────────
// Generic single-transaction lookup, outlet-scoped like everything else
// in this module. Used directly by GET /inventory/adjustments/:id
// (via getAdjustmentById below) and available for reuse by any future
// single-transaction endpoint without duplicating this query.
// Sprint 7.6 — enriched with product/outlet via enrichWithProductAndOutlet.

export const getTransactionById = async (tenantId, outletId, transactionId) => {
  const filter = {
    _id:      new mongoose.Types.ObjectId(transactionId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }
  if (outletId) filter.outletId = new mongoose.Types.ObjectId(outletId)

  const txn = await InventoryTransaction.findOne(filter).lean()
  if (!txn) {
    throw new ApiError(404, 'Inventory transaction not found')
  }

  return enrichWithProductAndOutlet(txn)
}

// ── getAdjustmentById ─────────────────────────────────────────
// GET /inventory/adjustments/:id
//
// Reuses getTransactionById — only adds the type='adjustment' scoping
// check on top (404 if the id exists but isn't an adjustment), so this
// endpoint stays semantically scoped without a second query implementation.

export const getAdjustmentById = async (tenantId, outletId, transactionId) => {
  const txn = await getTransactionById(tenantId, outletId, transactionId)

  if (txn.type !== 'adjustment') {
    throw new ApiError(404, 'Inventory transaction not found')
  }

  return txn
}

// ============================================================
// Sprint 8.1 — Production Module.
//
// The write path (createProductionBatch — InventoryBatch.create +
// InventoryTransaction(type='production'), one session, one new batch
// per call, never reuses a previous batch) already exists unchanged from
// Sprint 6.2. The two functions below are READ-ONLY thin wrappers over
// the SAME listTransactions/getTransactionById/getBatchById already used
// by adjustments — mirroring listAdjustments/getAdjustmentById exactly.
// No new inventory logic, no new lookup implementation, no schema change.
// ============================================================

// ── listProduction ────────────────────────────────────────────
// GET /production
//
// Thin wrapper over listTransactions — reuses its filtering (productId,
// dateFrom/dateTo, sort, order), pagination, and product/outlet $lookup
// entirely; only forces type='production'. No logic duplicated.
//
// Sprint 8.2 additions (still calling the same listTransactions
// underneath, no parallel pipeline):
//   - `period` quick-filter ('today'|'thisWeek'|'thisMonth') resolved
//     into dateFrom/dateTo here — dateFrom/dateTo passed directly still
//     work unchanged for a custom range (period simply takes precedence
//     if both are somehow given).
//   - `search` here means "Product Name OR Batch ID" (not notes, unlike
//     the generic /inventory/transactions & /inventory/adjustments
//     search) — a 24-char hex string is treated as an exact batchId
//     match; anything else resolves to matching productIds via the
//     existing Product model, then passed as listTransactions' new
//     (Sprint 8.2, additive) `productIds` filter. This does NOT change
//     listAdjustments' own search behavior (notes) — resolved entirely
//     here, before delegating.

const resolvePeriodFilter = (queryParams) => {
  if (!queryParams.period) return queryParams

  const now = new Date()
  let dateFrom

  if (queryParams.period === 'today') {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  } else if (queryParams.period === 'thisWeek') {
    const day = now.getDay() // 0 = Sunday
    const diffToMonday = day === 0 ? 6 : day - 1
    dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday)
  } else if (queryParams.period === 'thisMonth') {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), 1)
  } else {
    return queryParams // unknown value — ignore, fall back to any explicit dateFrom/dateTo
  }

  return { ...queryParams, dateFrom: dateFrom.toISOString() }
}

export const listProduction = async (tenantId, outletId, queryParams = {}) => {
  const resolved = resolvePeriodFilter(queryParams)
  const params = { ...resolved, type: 'production' }
  delete params.search
  delete params.period

  if (resolved.search) {
    const term = resolved.search.trim()
    const looksLikeObjectId = mongoose.Types.ObjectId.isValid(term) && term.length === 24

    if (looksLikeObjectId) {
      params.batchId = term
    } else if (term) {
      const matchingProducts = await Product.find({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        name: { $regex: term, $options: 'i' },
      }).select('_id').lean()
      params.productIds = matchingProducts.map((p) => p._id)
    }
  }

  return listTransactions(tenantId, outletId, params)
}

// ── getProductionById ─────────────────────────────────────────
// GET /production/:id
//
// Reuses getTransactionById (the production transaction itself — already
// enriched with product/outlet) AND getBatchById (the batch it created —
// already enriched with product/outlet, ageInDays, freshness). One
// production = one batch = one transaction, so this is a simple 1:1 join
// of two already-existing single-document lookups — no new query logic.

export const getProductionById = async (tenantId, outletId, transactionId) => {
  const transaction = await getTransactionById(tenantId, outletId, transactionId)

  if (transaction.type !== 'production') {
    throw new ApiError(404, 'Production record not found')
  }

  const batch = await getBatchById(tenantId, outletId, transaction.batchId)

  return { transaction, batch }
}

// ── getProductionDashboard ────────────────────────────────────
// GET /production/dashboard
//
// Sprint 8.2. Reuses the exact aggregation style already established in
// getInventoryDashboard (Sprint 6.4/7.1): buildTenantOutletFilter for
// scope, simple $group aggregations for totals, Product $lookup for
// per-product breakdown (same technique as getInventoryOverview), and
// enrichWithProductAndOutlet for the recent-activity list (same as every
// other single/small-list read in this module). No new aggregation
// technique introduced.

export const getProductionDashboard = async (tenantId, outletId, queryParams = {}) => {
  const filter = buildTenantOutletFilter(tenantId, outletId, queryParams.outletId)
  const productionFilter = { ...filter, type: 'production' }

  const now          = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [[todayAgg], [monthAgg]] = await Promise.all([
    InventoryTransaction.aggregate([
      { $match: { ...productionFilter, createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, count: { $sum: 1 }, totalQuantity: { $sum: '$quantityDelta' } } },
    ]),
    InventoryTransaction.aggregate([
      { $match: { ...productionFilter, createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, count: { $sum: 1 }, totalQuantity: { $sum: '$quantityDelta' } } },
    ]),
  ])

  // productionByProduct — this month, grouped by product (same $lookup
  // technique as getInventoryOverview's per-product rollup).
  const productionByProduct = await InventoryTransaction.aggregate([
    { $match: { ...productionFilter, createdAt: { $gte: startOfMonth } } },
    { $group: { _id: '$productId', count: { $sum: 1 }, totalQuantity: { $sum: '$quantityDelta' } } },
    {
      $lookup: {
        from:         Product.collection.name,
        localField:   '_id',
        foreignField: '_id',
        as:           'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0, productId: '$_id', productName: '$product.name', count: 1, totalQuantity: 1,
      },
    },
    { $sort: { totalQuantity: -1 } },
  ])

  // Last 7 days daily breakdown (for a simple bar/line chart) — same
  // $match scope, grouped by calendar day.
  const sevenDaysAgo = new Date(startOfToday)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6) // 7 days inclusive of today

  const last7DaysRaw = await InventoryTransaction.aggregate([
    { $match: { ...productionFilter, createdAt: { $gte: sevenDaysAgo } } },
    {
      $group: {
        _id:           { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count:         { $sum: 1 },
        totalQuantity: { $sum: '$quantityDelta' },
      },
    },
    { $sort: { _id: 1 } },
  ])

  // Fill in zero-days so the chart always has exactly 7 points, oldest first.
  const last7DaysMap = new Map(last7DaysRaw.map((d) => [d._id, d]))
  const last7Days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().split('T')[0]
    const found = last7DaysMap.get(key)
    last7Days.push({ date: key, count: found?.count ?? 0, totalQuantity: found?.totalQuantity ?? 0 })
  }

  // Recent production — last 10, enriched with product/outlet (reuses
  // enrichWithProductAndOutlet, same helper used by getBatchById/
  // getTransactionById — no duplicate lookup implementation).
  const recentRaw = await InventoryTransaction
    .find(productionFilter)
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()

  const recentProduction = await Promise.all(recentRaw.map((txn) => enrichWithProductAndOutlet(txn)))

  return {
    todayProduction: todayAgg?.count ?? 0,
    monthProduction: monthAgg?.count ?? 0,
    todayQuantity:   todayAgg?.totalQuantity ?? 0,
    monthQuantity:   monthAgg?.totalQuantity ?? 0,
    productionByProduct,
    last7Days,
    recentProduction,
  }
}