// ============================================================
// modules/plan/plan.service.js
// Plan management — super_admin only writes, public reads.
// Sprint 2 — Subscription & Plan Management
// ============================================================

import mongoose from 'mongoose'
import Plan     from '../../models/Plan.model.js'
import ApiError from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── getPlans ──────────────────────────────────────────────────

/**
 * List all active plans, ordered by sortOrder.
 * Public — no auth required.
 */
export const getPlans = async (queryParams = {}) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = {}
  if (queryParams.isActive !== undefined) {
    filter.isActive = queryParams.isActive === 'true'
  } else {
    filter.isActive = true   // default: active plans only
  }

  const [plans, total] = await Promise.all([
    Plan.find(filter).sort({ sortOrder: 1 }).skip(skip).limit(limit).lean(),
    Plan.countDocuments(filter),
  ])

  return { plans, pagination: buildPaginationMeta({ total, page, limit }) }
}

// ── getPlanById ───────────────────────────────────────────────

export const getPlanById = async (planId) => {
  const plan = await Plan.findById(new mongoose.Types.ObjectId(planId)).lean()
  if (!plan) throw new ApiError(404, 'Plan not found')
  return plan
}

// ── getPlanBySlug ─────────────────────────────────────────────

export const getPlanBySlug = async (slug) => {
  const plan = await Plan.findOne({ slug }).lean()
  if (!plan) throw new ApiError(404, `Plan with slug "${slug}" not found`)
  return plan
}

// ── createPlan ────────────────────────────────────────────────

export const createPlan = async (data) => {
  try {
    const plan = await Plan.create({
      name:        data.name.trim(),
      slug:        data.slug,
      description: data.description?.trim() ?? null,
      price:       data.price ?? 0,
      sortOrder:   data.sortOrder ?? 0,
      limits:      data.limits   ?? {},
      features:    data.features ?? {},
      addOnPrices: data.addOnPrices ?? {},
      isActive:    true,
    })
    return plan.toObject()
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `A plan with slug "${data.slug}" already exists`)
    }
    throw err
  }
}

// ── updatePlan ────────────────────────────────────────────────

/**
 * Updates a plan. Limit/feature changes affect all tenants on this plan
 * immediately — checkPlanLimit reads the live Plan document at check time.
 */
export const updatePlan = async (planId, data) => {
  const updateData = {}

  if (data.name        !== undefined) updateData.name        = data.name.trim()
  if (data.description !== undefined) updateData.description = data.description?.trim() ?? null
  if (data.price       !== undefined) updateData.price       = data.price
  if (data.sortOrder   !== undefined) updateData.sortOrder   = data.sortOrder

  // Deep merge limits — only override provided fields
  if (data.limits) {
    for (const [key, val] of Object.entries(data.limits)) {
      updateData[`limits.${key}`] = val
    }
  }

  // Deep merge features
  if (data.features) {
    for (const [key, val] of Object.entries(data.features)) {
      updateData[`features.${key}`] = val
    }
  }

  // Deep merge addOnPrices
  if (data.addOnPrices) {
    for (const [key, val] of Object.entries(data.addOnPrices)) {
      updateData[`addOnPrices.${key}`] = val
    }
  }

  const plan = await Plan.findByIdAndUpdate(
    new mongoose.Types.ObjectId(planId),
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!plan) throw new ApiError(404, 'Plan not found')
  return plan
}

// ── togglePlanActive ──────────────────────────────────────────

export const togglePlanActive = async (planId) => {
  const plan = await Plan.findById(new mongoose.Types.ObjectId(planId))
  if (!plan) throw new ApiError(404, 'Plan not found')
  plan.isActive = !plan.isActive
  await plan.save()
  return plan.toObject()
}