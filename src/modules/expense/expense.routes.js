// ============================================================
// modules/expense/expense.routes.js
// Route definitions for the expense module.
// Mounted at: /api/v1/expenses
//
// Authorization:
//   MANAGE_EXPENSES → create, update, delete
//   VIEW_EXPENSES   → read (list, detail)
//
// Cashier: MANAGE_EXPENSES is NOT in cashier's permission set.
// Spec grants cashier only VIEW_SALES, not expense management.
// Expense management is manager and above only.
// ============================================================

import { Router } from 'express'
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
} from './expense.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_EXPENSES),
  create
)

router.get(
  '/',
  authorize(PERMISSIONS.VIEW_EXPENSES, PERMISSIONS.MANAGE_EXPENSES),
  getAll
)

router.get(
  '/:expenseId',
  validateObjectId('expenseId'),
  authorize(PERMISSIONS.VIEW_EXPENSES, PERMISSIONS.MANAGE_EXPENSES),
  getOne
)

router.patch(
  '/:expenseId',
  validateObjectId('expenseId'),
  authorize(PERMISSIONS.MANAGE_EXPENSES),
  update
)

router.delete(
  '/:expenseId',
  validateObjectId('expenseId'),
  authorize(PERMISSIONS.MANAGE_EXPENSES),
  remove
)

export default router