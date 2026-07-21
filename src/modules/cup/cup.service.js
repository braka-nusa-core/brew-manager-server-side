// ============================================================
// modules/cup/cup.service.js
// All CupRecord business logic.
//
// KEY RULES:
//   [CR1] One CupRecord per rider per date (unique index)
//   [CR5] Draft records freely updatable; finalized are immutable
//   [CR6] Only employees with isRider: true can be assigned
//   [CR7] Finalized records cannot be deleted
//
// Balance check (validateFinalize) is in cup.validation.js.
// Service calls validator at finalize time.
// ============================================================

import mongoose  from 'mongoose'
import CupRecord from '../../models/CupRecord.model.js'
import Employee  from '../../models/Employee.model.js'
import Product   from '../../models/Product.model.js'
import Sale      from '../../models/Sale.model.js'
import ApiError  from '../../utils/ApiError.js'
import { validateFinalize } from './cup.validation.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── Helpers ───────────────────────────────────────────────────

/**
 * Normalizes a date to midnight UTC.
 * Prevents time-of-day differences from creating duplicate records.
 */
const toMidnightUTC = (dateInput) => {
  const d = new Date(dateInput)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Computes balance per item (carried - accounted).
 * Balance = 0 means fully reconciled.
 * Not stored — computed on-read.
 */
const addBalanceToItems = (items) =>
  items.map((item) => {
    const carried   = (item.distributed ?? 0) + (item.refill ?? 0)
    const accounted = (item.sold ?? 0) + (item.returned ?? 0) + (item.reject ?? 0)
    return {
      ...item,
      carried,
      accounted,
      balance: carried - accounted,
    }
  })

// ── Phase 1: dispatch/refill log helpers ────────────────────────

/**
 * Sums the `quantity` field across a log array. Used to derive
 * distributed/refill from dispatchLogs/refillLogs.
 */
const sumLog = (logs) => (logs ?? []).reduce((total, l) => total + (l.quantity ?? 0), 0)

/**
 * Builds a plain item object for create(), seeding dispatchLogs with
 * one entry equal to the initial `distributed` amount (if > 0), so
 * distributed always equals sum(dispatchLogs) from the moment a
 * CupRecord is created (dispatch = creation, per the new business flow).
 */
const buildItemWithInitialDispatchLog = (item, userId) => {
  const distributed = item.distributed ?? 0
  const dispatchLogs = distributed > 0
    ? [{ quantity: distributed, createdBy: new mongoose.Types.ObjectId(userId), createdAt: new Date() }]
    : []

  return {
    productId:    new mongoose.Types.ObjectId(item.productId),
    distributed,
    refill:       item.refill ?? 0,
    sold:         item.sold ?? 0,
    returned:     item.returned ?? 0,
    reject:       item.reject ?? 0,
    dispatchLogs,
    // If a non-zero refill is supplied directly at creation (legacy
    // callers may do this), record it as a log too so refill stays
    // derived from refillLogs.
    refillLogs: (item.refill ?? 0) > 0
      ? [{ quantity: item.refill, createdBy: new mongoose.Types.ObjectId(userId), createdAt: new Date(), notes: 'Set at creation' }]
      : [],
  }
}

/**
 * Legacy PATCH /:id items[] replacement — overwrites the aggregate
 * fields (distributed, refill, sold, returned, reject) exactly as
 * requested, WITHOUT touching dispatchLogs/refillLogs.
 *
 * Delta fix: no synthetic "adjustment" log entries are manufactured
 * here anymore. PATCH is legacy/emergency-correction only in the new
 * workflow (dispatch/refill always go through their dedicated
 * endpoints), so dispatchLogs/refillLogs must only ever contain real
 * business events. Existing logs for a product (matched by productId)
 * are carried over untouched; a brand-new product has empty logs,
 * same as before Phase 1 existed.
 *
 * @param {Array} existingItems - record.items (subdocuments, pre-update)
 * @param {Array} newItems      - data.items from request body
 */
const overwriteItemsPreservingLogs = (existingItems, newItems) => {
  const existingByProduct = new Map(
    (existingItems ?? []).map((i) => [i.productId.toString(), i])
  )

  return newItems.map((item) => {
    const existing = existingByProduct.get(item.productId.toString())

    return {
      productId:    new mongoose.Types.ObjectId(item.productId),
      distributed:  item.distributed ?? 0,
      refill:       item.refill ?? 0,
      sold:         item.sold ?? 0,
      returned:     item.returned ?? 0,
      reject:       item.reject ?? 0,
      dispatchLogs: existing ? existing.dispatchLogs : [],
      refillLogs:   existing ? existing.refillLogs : [],
    }
  })
}

/**
 * Auto-generates (or idempotently updates) the Sale document for a
 * just-finalized CupRecord. Revenue = sum(item.sold * Product.sellingPrice).
 * Upserted by sourceCupRecordId so re-running is safe and it never
 * collides with manually-entered Sale records for the same rider/date.
 *
 * Never throws to the caller in a way that would roll back the
 * finalize itself in spirit — but per Phase 1 scope we let errors
 * surface normally since Sale generation is part of the finalize
 * contract now (matches the requirement "Sales become system-generated").
 *
 * @param {Object} record - the finalized CupRecord (mongoose doc, plain items ok)
 * @param {string} userId - who finalized (becomes recordedBy)
 */
const generateSaleFromCupRecord = async (record, userId) => {
  const productIds = record.items.map((i) => i.productId)
  const products    = await Product.find({ _id: { $in: productIds } }).lean()
  const priceMap     = new Map(products.map((p) => [p._id.toString(), p.sellingPrice ?? 0]))

  let totalCups    = 0
  let totalRevenue = 0

  for (const item of record.items) {
    const sold  = item.sold ?? 0
    const price = priceMap.get(item.productId.toString()) ?? 0
    totalCups    += sold
    totalRevenue += sold * price
  }

  await Sale.findOneAndUpdate(
    { sourceCupRecordId: record._id },
    {
      $set: {
        tenantId:          record.tenantId,
        outletId:          record.outletId,
        employeeId:        record.riderId,
        date:              record.date,
        totalCups,
        totalRevenue,
        origin:            'system',
        sourceCupRecordId: record._id,
        recordedBy:        new mongoose.Types.ObjectId(userId),
        notes:             'Auto-generated from CupRecord finalize',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
}

// ── createCupRecord ───────────────────────────────────────────

/**
 * Creates a new CupRecord in draft status.
 * Validates that riderId belongs to an active rider in the tenant.
 *
 * @param {string} tenantId - from req.tenantId
 * @param {string} outletId - from req.outletId or req.body
 * @param {Object} data     - validated req.body
 * @param {string} userId   - req.user.userId
 */
export const createCupRecord = async (tenantId, outletId, data, userId) => {
  const tenantOid = new mongoose.Types.ObjectId(tenantId)
  const date      = toMidnightUTC(data.date)

  // [CR6] Verify rider exists in tenant and has isRider: true
  const rider = await Employee.findOne({
    _id:      new mongoose.Types.ObjectId(data.riderId),
    tenantId: tenantOid,
    isRider:  true,
    isActive: true,
  }).lean()

  if (!rider) {
    throw new ApiError(
      404,
      'Rider not found. Ensure the employee exists, is active, and has employeeType "rider".'
    )
  }

  // Determine outletId — from rider's outletId (more reliable than body)
  const recordOutletId = rider.outletId ?? new mongoose.Types.ObjectId(outletId)

  // Build items — normalize all numeric fields to integers, default 0.
  // Phase 1: dispatch = creation, so seed dispatchLogs (and refillLogs,
  // if a non-zero refill is supplied directly) for audit trail purposes.
  const items = data.items.map((item) => buildItemWithInitialDispatchLog(item, userId))

  try {
    const record = await CupRecord.create({
      tenantId:   tenantOid,
      outletId:   recordOutletId,
      riderId:    new mongoose.Types.ObjectId(data.riderId),
      date,
      items,
      notes:      data.notes?.trim() ?? null,
      status:     'draft',
      recordedBy: new mongoose.Types.ObjectId(userId),
    })

    return {
      ...record.toObject(),
      items: addBalanceToItems(record.toObject().items),
    }

  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(
        409,
        `A cup record for this rider on ${date.toISOString().split('T')[0]} already exists`
      )
    }
    throw err
  }
}

// ── getCupRecords ─────────────────────────────────────────────

/**
 * Paginated list of cup records.
 * Filters: riderId, outletId, status, startDate, endDate, date.
 */
export const getCupRecords = async (tenantId, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = { tenantId: new mongoose.Types.ObjectId(tenantId) }

  if (queryParams.riderId) {
    filter.riderId = new mongoose.Types.ObjectId(queryParams.riderId)
  }

  if (queryParams.outletId) {
    filter.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.status) {
    filter.status = queryParams.status
  }

  // Single date filter
  if (queryParams.date) {
    filter.date = toMidnightUTC(queryParams.date)
  }

  // Date range
  if (queryParams.startDate || queryParams.endDate) {
    filter.date = {}
    if (queryParams.startDate) filter.date.$gte = toMidnightUTC(queryParams.startDate)
    if (queryParams.endDate)   filter.date.$lte = toMidnightUTC(queryParams.endDate)
  }

  const [records, total] = await Promise.all([
    CupRecord.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CupRecord.countDocuments(filter),
  ])

  // Add computed balance to all items
  const recordsWithBalance = records.map((r) => ({
    ...r,
    items: addBalanceToItems(r.items),
  }))

  return {
    records: recordsWithBalance,
    pagination: buildPaginationMeta({ total, page, limit }),
  }
}

// ── getCupRecordById ──────────────────────────────────────────

export const getCupRecordById = async (tenantId, cupRecordId) => {
  const record = await CupRecord.findOne({
    _id:      new mongoose.Types.ObjectId(cupRecordId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).lean()

  if (!record) throw new ApiError(404, 'Cup record not found')

  return {
    ...record,
    items: addBalanceToItems(record.items),
  }
}

// ── updateCupRecord ───────────────────────────────────────────

/**
 * Updates items and/or notes on a DRAFT cup record.
 * Finalized records cannot be updated.
 *
 * @param {string} tenantId
 * @param {string} cupRecordId
 * @param {Object} data - validated req.body { items?, notes? }
 * @param {string} userId
 */
export const updateCupRecord = async (tenantId, cupRecordId, data, userId) => {
  const record = await CupRecord.findOne({
    _id:      new mongoose.Types.ObjectId(cupRecordId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })

  if (!record) throw new ApiError(404, 'Cup record not found')

  // [CR5] Finalized records are immutable
  if (record.status === 'finalized') {
    throw new ApiError(
      409,
      'This cup record has been finalized and cannot be modified. Delete and re-create to correct.'
    )
  }

  if (data.items !== undefined) {
    // Delta fix: PATCH is legacy/emergency-correction only — it must
    // NEVER manufacture dispatchLogs/refillLogs entries. Existing real
    // log history (if any, matched by productId) is preserved as-is;
    // only the aggregate distributed/refill/sold/returned/reject fields
    // are overwritten, exactly like the pre-Phase-1 behavior.
    record.items = overwriteItemsPreservingLogs(record.items, data.items)
  }

  if (data.notes !== undefined) {
    record.notes = data.notes?.trim() ?? null
  }

  record.recordedBy = new mongoose.Types.ObjectId(userId)

  await record.save()

  return {
    ...record.toObject(),
    items: addBalanceToItems(record.toObject().items),
  }
}

// ── addCupRefill ─────────────────────────────────────────────
//
// Phase 1: appends a refill log entry per product to a DRAFT record.
// A rider can be refilled multiple times a day — each call to this
// endpoint is one refill event (Dispatch → Refill 1 → Refill 2 → ...).
// item.refill is recomputed as sum(refillLogs) after each append.

/**
 * @param {string} tenantId
 * @param {string} cupRecordId
 * @param {Object} data - validated req.body { items: [{ productId, quantity, notes? }] }
 * @param {string} userId
 */
export const addCupRefill = async (tenantId, cupRecordId, data, userId) => {
  const record = await CupRecord.findOne({
    _id:      new mongoose.Types.ObjectId(cupRecordId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })

  if (!record) throw new ApiError(404, 'Cup record not found')

  if (record.status === 'finalized') {
    throw new ApiError(409, 'This cup record has been finalized and cannot be refilled.')
  }

  const itemsByProduct = new Map(
    record.items.map((item) => [item.productId.toString(), item])
  )

  for (const refillInput of data.items) {
    const item = itemsByProduct.get(refillInput.productId)

    if (!item) {
      throw new ApiError(
        400,
        `Product ${refillInput.productId} is not part of this cup record. Refill can only apply to products already dispatched.`
      )
    }

    item.refillLogs.push({
      quantity:  refillInput.quantity,
      createdBy: new mongoose.Types.ObjectId(userId),
      createdAt: new Date(),
      notes:     refillInput.notes?.trim() ?? null,
    })

    item.refill = sumLog(item.refillLogs)
  }

  record.recordedBy = new mongoose.Types.ObjectId(userId)
  await record.save()

  return {
    ...record.toObject(),
    items: addBalanceToItems(record.toObject().items),
  }
}

// ── finalizeCupRecord ─────────────────────────────────────────

/**
 * Validates per-product balance and transitions status to 'finalized'.
 *
 * Balance rule per item:
 *   (distributed + refill) === (sold + returned + reject)
 *
 * ALL items must balance. Returns 400 with detailed breakdown if any fail.
 *
 * @param {string} tenantId
 * @param {string} cupRecordId
 * @param {string} userId - who is finalizing
 */
export const finalizeCupRecord = async (tenantId, cupRecordId, userId) => {
  const record = await CupRecord.findOne({
    _id:      new mongoose.Types.ObjectId(cupRecordId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })

  if (!record) throw new ApiError(404, 'Cup record not found')

  if (record.status === 'finalized') {
    throw new ApiError(409, 'Cup record is already finalized')
  }

  // Build productId → name lookup for readable error messages
  const productIds = record.items.map((i) => i.productId)
  const products   = await Product.find({
    _id: { $in: productIds },
  }).lean()
  const productNameMap = new Map(products.map((p) => [p._id.toString(), p.name]))

  const getProductName = (id) => productNameMap.get(id) ?? id

  // Validate balance for all items
  const { isValid, errors, breakdown } = validateFinalize(
    record.toObject().items,
    getProductName
  )

  if (!isValid) {
    throw new ApiError(400, errors.join('\n'), errors)
  }

  // All balanced — finalize
  record.status      = 'finalized'
  record.finalizedBy = new mongoose.Types.ObjectId(userId)
  record.finalizedAt = new Date()
  await record.save()

  // Phase 1: automatic Sale generation. Revenue = sold * Product.sellingPrice.
  // Upserted by sourceCupRecordId — idempotent, never touches manually
  // entered Sale records. Dashboard/Payroll are unchanged — they already
  // aggregate over the Sale collection, so this record is picked up
  // automatically the next time they run.
  await generateSaleFromCupRecord(record.toObject(), userId)

  return {
    ...record.toObject(),
    items: addBalanceToItems(record.toObject().items),
    reconciliationBreakdown: breakdown,
  }
}

// ── deleteCupRecord ───────────────────────────────────────────

/**
 * Hard-deletes a DRAFT cup record.
 * Finalized records cannot be deleted — they are financial records.
 *
 * @param {string} tenantId
 * @param {string} cupRecordId
 */
export const deleteCupRecord = async (tenantId, cupRecordId) => {
  const record = await CupRecord.findOne({
    _id:      new mongoose.Types.ObjectId(cupRecordId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })

  if (!record) throw new ApiError(404, 'Cup record not found')

  if (record.status === 'finalized') {
    throw new ApiError(
      409,
      'Finalized cup records cannot be deleted. They are part of the financial audit trail.'
    )
  }

  await CupRecord.deleteOne({ _id: record._id })
}

// ── getReconciliation ─────────────────────────────────────────

/**
 * Aggregated daily cup reconciliation summary.
 * Groups by date and rider, summing all item quantities per product.
 *
 * Used for: outlet-level oversight, daily closing review.
 *
 * Filters: outletId (required for non-admin), riderId, startDate, endDate, status
 *
 * @param {string} tenantId
 * @param {Object} queryParams
 */
export const getReconciliation = async (tenantId, queryParams) => {
  const matchStage = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }

  if (queryParams.outletId) {
    matchStage.outletId = new mongoose.Types.ObjectId(queryParams.outletId)
  }

  if (queryParams.riderId) {
    matchStage.riderId = new mongoose.Types.ObjectId(queryParams.riderId)
  }

  if (queryParams.status) {
    matchStage.status = queryParams.status
  }

  if (queryParams.startDate || queryParams.endDate) {
    matchStage.date = {}
    if (queryParams.startDate) matchStage.date.$gte = toMidnightUTC(queryParams.startDate)
    if (queryParams.endDate)   matchStage.date.$lte = toMidnightUTC(queryParams.endDate)
  }

  const results = await CupRecord.aggregate([
    { $match: matchStage },

    // Unwind items to aggregate per product
    { $unwind: '$items' },

    // Group by date + rider + product
    {
      $group: {
        _id: {
          date:      '$date',
          riderId:   '$riderId',
          outletId:  '$outletId',
          productId: '$items.productId',
          status:    '$status',
        },
        distributed: { $sum: '$items.distributed' },
        refill:      { $sum: '$items.refill'      },
        sold:        { $sum: '$items.sold'         },
        returned:    { $sum: '$items.returned'     },
        reject:      { $sum: '$items.reject'       },
      },
    },

    // Compute carried, accounted, balance
    {
      $addFields: {
        carried:    { $add: ['$distributed', '$refill'] },
        accounted:  { $add: ['$sold', '$returned', '$reject'] },
        balance:    {
          $subtract: [
            { $add: ['$distributed', '$refill'] },
            { $add: ['$sold', '$returned', '$reject'] },
          ],
        },
      },
    },

    // Sort by date desc, then rider, then product
    {
      $sort: {
        '_id.date':      -1,
        '_id.riderId':    1,
        '_id.productId':  1,
      },
    },
  ])

  return results
}