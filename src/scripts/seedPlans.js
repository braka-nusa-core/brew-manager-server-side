// ============================================================
// scripts/seedPlans.js
// One-time idempotent seed script for Sprint 2.
//
// What it does:
//   1. Creates the 3 canonical Plan documents if they don't exist.
//      (Uses upsert on slug — safe to run multiple times.)
//   2. For every existing Tenant with no Subscription, creates
//      a trial Subscription pointing to the matching Plan.
//
// Source of truth: Braka Nusa Core pricing sheet (2024)
//   Starter  — IDR 299k/month
//   Growth   — IDR 599k/month
//   Business — IDR 1.2M/month
//
// Usage:
//   node scripts/seedPlans.js
//
// Requires MONGODB_URI in environment (or .env file).
// ============================================================

import mongoose    from 'mongoose'
import dotenv      from 'dotenv'
import Plan        from '../models/Plan.model.js'
import Subscription from '../models/Subscription.model.js'
import Tenant      from '../models/Tenant.model.js'

dotenv.config()

const PLANS = [
  {
    name:        'Starter',
    slug:        'starter',
    description: 'Cocok untuk usaha kecil dengan 1 outlet.',
    price:       299000,
    sortOrder:   0,
    limits: {
      maxOutlets:   1,
      maxEmployees: 15,
      maxAdmins:    1,
      maxBikes:     -1,
      maxProducts:  -1,
    },
    features: {
      attendance:        true,
      salesTracking:     true,
      expenseTracking:   true,
      payrollBasic:      true,
      dashboardBasic:    true,
      riderPortal:       true,
      outletPerformance: false,
      advancedDashboard: false,
      customReports:     false,
      businessAnalytics: false,
      payrollAdvanced:   false,
    },
    addOnPrices: {
      perExtraOutlet:   75000,
      perExtraEmployee: 25000,
      perExtraAdmin:    50000,
    },
    isActive: true,
  },
  {
    name:        'Growth',
    slug:        'growth',
    description: 'Untuk bisnis yang sedang berkembang.',
    price:       599000,
    sortOrder:   1,
    limits: {
      maxOutlets:   3,
      maxEmployees: 60,
      maxAdmins:    3,
      maxBikes:     -1,
      maxProducts:  -1,
    },
    features: {
      attendance:        true,
      salesTracking:     true,
      expenseTracking:   true,
      payrollBasic:      true,
      dashboardBasic:    true,
      riderPortal:       true,
      outletPerformance: true,
      advancedDashboard: true,
      customReports:     false,
      businessAnalytics: false,
      payrollAdvanced:   false,
    },
    addOnPrices: {
      perExtraOutlet:   75000,
      perExtraEmployee: 25000,
      perExtraAdmin:    50000,
    },
    isActive: true,
  },
  {
    name:        'Business',
    slug:        'business',
    description: 'Untuk brand coffee shop multi cabang.',
    price:       1200000,
    sortOrder:   2,
    limits: {
      maxOutlets:   8,
      maxEmployees: 200,
      maxAdmins:    10,
      maxBikes:     -1,
      maxProducts:  -1,
    },
    features: {
      attendance:        true,
      salesTracking:     true,
      expenseTracking:   true,
      payrollBasic:      true,
      dashboardBasic:    true,
      riderPortal:       true,
      outletPerformance: true,
      advancedDashboard: true,
      customReports:     true,
      businessAnalytics: true,
      payrollAdvanced:   true,
    },
    addOnPrices: {
      perExtraOutlet:   75000,
      perExtraEmployee: 25000,
      perExtraAdmin:    50000,
    },
    isActive: true,
  },
]

const seed = async () => {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('❌  MONGODB_URI is not set. Create a .env file or export the variable.')
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log('✅  Connected to MongoDB')

  // ── 1. Upsert Plans ────────────────────────────────────────
  console.log('\n── Seeding Plans ──')
  const planMap = {}   // slug → _id, needed for subscription creation

  for (const planData of PLANS) {
    const plan = await Plan.findOneAndUpdate(
      { slug: planData.slug },
      { $setOnInsert: planData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()

    planMap[plan.slug] = plan._id
    console.log(`  ✅  ${plan.name} (${plan.slug}) — ${plan._id}`)
  }

  // ── 2. Backfill Subscriptions for existing tenants ─────────
  console.log('\n── Backfilling Subscriptions ──')

  const allTenants = await Tenant.find({ deletedAt: null, isActive: true }).lean()
  let created = 0
  let skipped = 0

  for (const tenant of allTenants) {
    const exists = await Subscription.findOne({ tenantId: tenant._id }).lean()
    if (exists) {
      skipped++
      continue
    }

    // Map Tenant.plan to a Plan slug. Handle legacy 'professional' → 'growth'.
    let slug = tenant.plan ?? 'starter'
    if (slug === 'professional') slug = 'growth'
    if (slug === 'enterprise')   slug = 'business'
    if (!planMap[slug])          slug = 'starter'

    await Subscription.create({
      tenantId:     tenant._id,
      planId:       planMap[slug],
      planSlug:     slug,
      status:       'trial',
      billingCycle: 'monthly',
      startedAt:    tenant.createdAt ?? new Date(),
    })

    console.log(`  ✅  Created subscription for tenant "${tenant.name}" (${slug})`)
    created++
  }

  console.log(`\n  Created: ${created}  Skipped (already had subscription): ${skipped}`)

  // ── Done ───────────────────────────────────────────────────
  console.log('\n✅  Seed complete.')
  await mongoose.disconnect()
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌  Seed failed:', err.message)
  mongoose.disconnect()
  process.exit(1)
})