// ============================================================
// modules/product/product.routes.js
// Mounted at: /api/v1/products
//
// Authorization:
//   MANAGE_PRODUCTS → create, update, delete
//   VIEW_PRODUCTS   → list, detail, margin
//
// Roles:
//   tenant_admin → full access
//   manager      → view only
//   cashier      → view only
// ============================================================

import { Router }       from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import validateObjectId from '../../middlewares/validateObjectId.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import {
  create,
  getAll,
  getOne,
  update,
  remove,
  getMargin,
} from './product.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// POST /api/v1/products
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_PRODUCTS),
  create
)

// GET /api/v1/products
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_PRODUCTS, PERMISSIONS.MANAGE_PRODUCTS),
  getAll
)

// GET /api/v1/products/:productId/margin
// MUST be registered before /:productId — same house style as
// cup.routes.js (/reconciliation before /:cupRecordId) and
// payroll.routes.js (/generate before /:payrollId). Not strictly
// required here since GET /:productId has no further path segment,
// but kept consistent with established convention.
router.get(
  '/:productId/margin',
  validateObjectId('productId'),
  authorize(PERMISSIONS.VIEW_PRODUCTS, PERMISSIONS.MANAGE_PRODUCTS),
  getMargin
)

// GET /api/v1/products/:productId
router.get(
  '/:productId',
  validateObjectId('productId'),
  authorize(PERMISSIONS.VIEW_PRODUCTS, PERMISSIONS.MANAGE_PRODUCTS),
  getOne
)

// PATCH /api/v1/products/:productId
router.patch(
  '/:productId',
  validateObjectId('productId'),
  authorize(PERMISSIONS.MANAGE_PRODUCTS),
  update
)

// DELETE /api/v1/products/:productId  (soft delete)
router.delete(
  '/:productId',
  validateObjectId('productId'),
  authorize(PERMISSIONS.MANAGE_PRODUCTS),
  remove
)

export default router