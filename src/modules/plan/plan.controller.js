// ============================================================
// modules/plan/plan.controller.js
// Sprint 2 — Plan Management
// ============================================================

import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse, errorResponse } from '../../utils/apiResponse.js'
import { validateCreatePlan, validateUpdatePlan } from './plan.validation.js'
import {
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  togglePlanActive,
} from './plan.service.js'

export const getAll = asyncHandler(async (req, res) => {
  const { plans, pagination } = await getPlans(req.query)
  return res.status(200).json({ success: true, message: 'Plans retrieved successfully', data: plans, pagination })
})

export const getOne = asyncHandler(async (req, res) => {
  const plan = await getPlanById(req.params.planId)
  return res.status(200).json(successResponse('Plan retrieved successfully', plan))
})

export const create = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateCreatePlan(req.body)
  if (!isValid) return res.status(400).json(errorResponse('Validation failed', 400, errors))

  const plan = await createPlan(req.body)
  return res.status(201).json(successResponse('Plan created successfully', plan))
})

export const update = asyncHandler(async (req, res) => {
  const { isValid, errors } = validateUpdatePlan(req.body)
  if (!isValid) return res.status(400).json(errorResponse('Validation failed', 400, errors))

  const plan = await updatePlan(req.params.planId, req.body)
  return res.status(200).json(successResponse('Plan updated successfully', plan))
})

export const toggleActive = asyncHandler(async (req, res) => {
  const plan = await togglePlanActive(req.params.planId)
  const msg  = plan.isActive ? 'Plan activated' : 'Plan deactivated'
  return res.status(200).json(successResponse(msg, plan))
})