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

  // Build items — normalize all numeric fields to integers, default 0
  const items = data.items.map((item) => ({
    productId:   new mongoose.Types.ObjectId(item.productId),
    distributed: item.distributed ?? 0,
    refill:      item.refill      ?? 0,
    sold:        item.sold        ?? 0,
    returned:    item.returned    ?? 0,
    reject:      item.reject      ?? 0,
  }))

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
    record.items = data.items.map((item) => ({
      productId:   new mongoose.Types.ObjectId(item.productId),
      distributed: item.distributed ?? 0,
      refill:      item.refill      ?? 0,
      sold:        item.sold        ?? 0,
      returned:    item.returned    ?? 0,
      reject:      item.reject      ?? 0,
    }))
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