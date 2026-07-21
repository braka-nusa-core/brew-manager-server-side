// ============================================================
// scripts/seedSuperAdmin.js
// One-time idempotent seed script — creates the Super Admin
// account representing Braka Nusa Core (the SaaS owner/developer),
// NOT a coffee shop owner. Coffee shop owners always use the
// tenant_admin role (see constants/permissions.js).
//
// This account is for internal system management only.
//
// What it does:
//   1. Connects to MongoDB using the app's existing connection
//      architecture (config/db.js + config/env.js).
//   2. Checks whether the Super Admin email already exists.
//      - If yes: prints "Super Admin already exists." and exits
//        successfully (idempotent — safe to run multiple times).
//   3. Otherwise creates the Super Admin using the existing
//      hashPassword utility (same hashing flow used by
//      user.service.js — never duplicated here).
//   4. Closes the DB connection before exiting.
//
// Usage:
//   node src/scripts/seedSuperAdmin.js
//   npm run seed:superadmin
//
// Requires MONGO_URI in environment (or .env file).
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'

import connectDB    from '../config/db.js'
import { validateEnv } from '../config/env.js'
import User          from '../models/User.model.js'
import hashPassword   from '../utils/hashPassword.js'
import { ROLES }      from '../constants/permissions.js'

// ── Super Admin fixed identity ─────────────────────────────────
// Represents Braka Nusa Core — the SaaS owner/developer.
// tenantId/outletId are intentionally omitted — they default to
// null on the User model, which is correct for super_admin.

const SUPER_ADMIN = {
  name:     'Braka Nusa Core',
  email:    'brakanusacore@gmail.com',
  password: 'Gebrakan123!',
  role:     ROLES.SUPER_ADMIN,
  isActive: true,
}

const seed = async () => {
  // ── Step 1: Validate environment, then connect ──────────────
  validateEnv()
  await connectDB()

  // ── Step 2: Check for existing Super Admin ──────────────────
  const existing = await User.findOne({
    email: SUPER_ADMIN.email.toLowerCase().trim(),
  }).lean()

  if (existing) {
    console.log('Super Admin already exists.')
    await mongoose.disconnect()
    process.exit(0)
  }

  // ── Step 3: Hash password using existing helper ─────────────
  const passwordHash = await hashPassword(SUPER_ADMIN.password)

  // ── Step 4: Create the Super Admin ──────────────────────────
  await User.create({
    name:         SUPER_ADMIN.name,
    email:        SUPER_ADMIN.email.toLowerCase().trim(),
    passwordHash,
    role:         SUPER_ADMIN.role,
    isActive:     SUPER_ADMIN.isActive,
  })

  console.log('✅  Super Admin created successfully.')

  // ── Step 5: Close DB connection before exiting ──────────────
  await mongoose.disconnect()
  process.exit(0)
}

seed().catch(async (err) => {
  console.error('❌  Super Admin seed failed:', err.message)
  await mongoose.disconnect()
  process.exit(1)
})