// ============================================================
// modules/productRecipe/productRecipe.routes.js
// Mounted at: /api/v1/products/:productId/recipe   (see app.js)
//
// NESTED SUB-RESOURCE — NOT a top-level resource.
// ProductRecipe has no independent list/search/page use case;
// it is always addressed through a specific Product. Approved
// architecture decision: keep nested, do not promote to
// /api/v1/product-recipes.
//
// Router({ mergeParams: true }) is REQUIRED here — without it,
// req.params.productId from the parent mount path in app.js
// would be invisible inside this child router. This is the
// only place in the codebase using mergeParams; documented here
// so the next maintainer doesn't need to discover it by
// debugging an undefined productId.
//
// EXPLICIT VALIDATION, NOT CastError-DRIVEN:
// validateObjectId('productId') runs on every route below even
// though :productId is declared on the PARENT path segment in
// app.js, not on any path declared in this file. With
// mergeParams: true, req.params.productId is visible here exactly
// as if it were declared locally — validateObjectId reads from
// req.params the same way it does in every other module's routes
// file. An invalid ObjectId now returns a clean 400 at the route
// layer, before the service or Mongoose ever sees it — consistent
// with how every other module in this codebase handles route params,
// and explicitly avoiding CastError-driven control flow.
//
// Authorization:
//   MANAGE_PRODUCTS → upsert (PUT), delete
//   VIEW_PRODUCTS   → get
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import { getOne, upsert, remove } from './productRecipe.controller.js'

const router = Router({ mergeParams: true })

router.use(authenticate)
router.use(tenantGuard)

// All three routes validate productId explicitly — it is merged
// in from the parent path, never declared as a local :param here.
router.use(validateObjectId('productId'))

// GET /api/v1/products/:productId/recipe
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_PRODUCTS, PERMISSIONS.MANAGE_PRODUCTS),
  getOne
)

// PUT /api/v1/products/:productId/recipe
router.put(
  '/',
  authorize(PERMISSIONS.MANAGE_PRODUCTS),
  upsert
)

// DELETE /api/v1/products/:productId/recipe
router.delete(
  '/',
  authorize(PERMISSIONS.MANAGE_PRODUCTS),
  remove
)

export default router