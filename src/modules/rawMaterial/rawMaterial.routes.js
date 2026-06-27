// ============================================================
// modules/rawMaterial/rawMaterial.routes.js
// Mounted at: /api/v1/raw-materials
//
// Authorization:
//   MANAGE_RAW_MATERIALS → create, update, delete
//   VIEW_RAW_MATERIALS   → list, detail
//
// Roles:
//   tenant_admin → full access
//   manager      → view only
//   cashier      → view only
//
// Mirrors product.routes.js exactly.
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
} from './rawMaterial.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

// POST /api/v1/raw-materials
router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_RAW_MATERIALS),
  create
)

// GET /api/v1/raw-materials
router.get(
  '/',
  authorize(PERMISSIONS.VIEW_RAW_MATERIALS, PERMISSIONS.MANAGE_RAW_MATERIALS),
  getAll
)

// GET /api/v1/raw-materials/:rawMaterialId
router.get(
  '/:rawMaterialId',
  validateObjectId('rawMaterialId'),
  authorize(PERMISSIONS.VIEW_RAW_MATERIALS, PERMISSIONS.MANAGE_RAW_MATERIALS),
  getOne
)

// PATCH /api/v1/raw-materials/:rawMaterialId
router.patch(
  '/:rawMaterialId',
  validateObjectId('rawMaterialId'),
  authorize(PERMISSIONS.MANAGE_RAW_MATERIALS),
  update
)

// DELETE /api/v1/raw-materials/:rawMaterialId  (soft delete)
router.delete(
  '/:rawMaterialId',
  validateObjectId('rawMaterialId'),
  authorize(PERMISSIONS.MANAGE_RAW_MATERIALS),
  remove
)

export default router