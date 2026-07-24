// ============================================================
// scripts/migrateInventory.js
// Sprint 6.1 — Cup Inventory & Freshness — ONE-TIME migration.
//
// What it does:
//   For every distinct (tenantId, outletId, productId) combination found
//   in historical CupRecord.items, creates EXACTLY ONE opening
//   InventoryBatch (if one doesn't already exist for that combination —
//   safe to re-run) plus ONE corresponding 'production' InventoryTransaction.
//
// Per the approved Sprint 6.1 architecture:
//   - NO fallback logic. NO guessing which batch a historical dispatch
//     came from. NO per-record batch backfill.
//   - Historical CupRecords are NEVER rewritten — this script only seeds
//     an opening balance so that, going forward, every dispatch/refill
//     resolves against a real InventoryBatch.
//   - Opening quantityInitial/quantityRemaining is a BEST-EFFORT estimate:
//     the `returned` quantity from that (outlet, product)'s most recently
//     FINALIZED CupRecord is used as a proxy for "believed on-hand stock
//     at cutover". This is a deliberate, known approximation (there is no
//     way to know true on-hand stock without a real physical stocktake) —
//     see the Sprint 6.1 architecture doc, "Migration data quality" risk.
//   - producedAt for every opening batch is the migration run date (`now`),
//     NOT any historical CupRecord date — freshness for pre-existing stock
//     starts counting from the moment it enters the new ledger.
//
// AFTER this script runs: every dispatch/refill MUST resolve to a valid
// InventoryBatch via FIFO (enforced by consumeFifo in inventory.service.js —
// it throws 409 if there's insufficient/no active stock). There is no
// runtime fallback path — if a product genuinely has zero opening stock,
// dispatch for it will correctly fail until real production batches are
// recorded going forward (out of scope for this sprint — batch *creation*
// beyond migration/opening stock is not implemented yet).
//
// Idempotency: safe to run multiple times — combinations that already
// have an InventoryBatch are skipped (checked via a lightweight per-combo
// existence query, not a special "origin" flag, per the "no special batch
// types" rule).
//
// Usage:
//   MIGRATION_USER_ID=<a valid User _id> node src/scripts/migrateInventory.js
//
// Requires MONGODB_URI in environment (or .env file) and MIGRATION_USER_ID
// (a valid User _id to attribute the opening 'production' transactions to
// — InventoryTransaction.createdBy is required and there is no logged-in
// user in a migration context).
// ============================================================

import mongoose      from 'mongoose'
import dotenv         from 'dotenv'
import CupRecord      from '../models/CupRecord.model.js'
import InventoryBatch from '../models/InventoryBatch.model.js'
import InventoryTransaction from '../models/InventoryTransaction.model.js'

dotenv.config()

const migrate = async () => {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('❌  MONGODB_URI is not set. Create a .env file or export the variable.')
    process.exit(1)
  }

  const migrationUserId = process.env.MIGRATION_USER_ID
  if (!migrationUserId || !mongoose.Types.ObjectId.isValid(migrationUserId)) {
    console.error('❌  MIGRATION_USER_ID is not set (or invalid) — required as createdBy for opening transactions.')
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log('✅  Connected to MongoDB')

  const now = new Date()

  // ── 1. Find every distinct (tenantId, outletId, productId) combo ──
  console.log('\n── Discovering historical (tenant, outlet, product) combinations ──')

  const combos = await CupRecord.aggregate([
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          tenantId:  '$tenantId',
          outletId:  '$outletId',
          productId: '$items.productId',
        },
      },
    },
  ])

  console.log(`  Found ${combos.length} combination(s).`)

  let created  = 0
  let skipped  = 0

  for (const combo of combos) {
    const { tenantId, outletId, productId } = combo._id

    // Idempotency check — skip combos that already have a batch (no
    // "origin"/"migration" flag needed; existence alone is sufficient).
    const alreadyExists = await InventoryBatch.findOne({ tenantId, outletId, productId }).lean()
    if (alreadyExists) {
      skipped++
      continue
    }

    // Best-effort opening quantity: `returned` from the most recently
    // FINALIZED CupRecord for this (outlet, product) — a proxy for
    // "believed on-hand stock at cutover". Defaults to 0 if no finalized
    // record with this product exists yet.
    const latestFinalized = await CupRecord.aggregate([
      {
        $match: {
          tenantId, outletId, status: 'finalized',
          'items.productId': productId,
        },
      },
      { $sort: { date: -1, finalizedAt: -1 } },
      { $limit: 1 },
      { $unwind: '$items' },
      { $match: { 'items.productId': productId } },
      { $project: { returned: '$items.returned' } },
    ])

    const openingQuantity = latestFinalized[0]?.returned ?? 0

    const batch = await InventoryBatch.create({
      tenantId,
      outletId,
      productId,
      producedAt:        now,
      quantityInitial:   openingQuantity,
      quantityRemaining: openingQuantity,
      status:            'active',
    })

    // InventoryTransaction.quantityDelta must be a non-zero integer (a
    // movement represents an actual change). An opening quantity of
    // exactly 0 has no real movement to record, so we only write the
    // 'production' transaction when there's something to log — the batch
    // itself is still created either way, so FIFO correctly finds "no
    // active stock" for that product without a misleading ledger entry.
    if (openingQuantity > 0) {
      await InventoryTransaction.create({
        tenantId,
        outletId,
        productId,
        batchId:       batch._id,
        type:          'production',
        quantityDelta: openingQuantity,
        cupRecordId:   null,
        createdBy:     new mongoose.Types.ObjectId(migrationUserId),
        notes:         'Opening balance — Sprint 6.1 inventory migration',
      })
    }

    console.log(`  ✅  Opened batch for product ${productId} @ outlet ${outletId} — qty ${openingQuantity}`)
    created++
  }

  console.log(`\n  Created: ${created}  Skipped (already migrated): ${skipped}`)
  console.log('\n✅  Migration complete.')
  await mongoose.disconnect()
  process.exit(0)
}

migrate().catch((err) => {
  console.error('❌  Migration failed:', err.message)
  mongoose.disconnect()
  process.exit(1)
})