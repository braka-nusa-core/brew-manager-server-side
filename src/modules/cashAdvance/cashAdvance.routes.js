// ============================================================
// modules/cashAdvance/cashAdvance.routes.js
// Mounted at: /api/v1/cash-advances
//
// Authorization:
//   MANAGE_CASH_ADVANCE → create
//   VIEW_CASH_ADVANCE   → read (list)
//
// New permission pair (Phase 3.5) — neither MANAGE_PAYROLL nor
// MANAGE_EMPLOYEE_WALLET is a clean semantic fit: this is explicitly
// NOT a Wallet transaction, and it's a distinct domain from Payroll's
// own workflow (Payroll only ever READS claimed advances at generation
// time — it doesn't manage them).
// ============================================================

import { Router } from 'express'
import authenticate     from '../../middlewares/authenticate.js'
import tenantGuard      from '../../middlewares/tenantGuard.js'
import authorize        from '../../middlewares/authorize.js'
import { PERMISSIONS }  from '../../constants/permissions.js'
import { create, getAll } from './cashAdvance.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

router.post(
  '/',
  authorize(PERMISSIONS.MANAGE_CASH_ADVANCE),
  create
)

router.get(
  '/',
  authorize(PERMISSIONS.VIEW_CASH_ADVANCE, PERMISSIONS.MANAGE_CASH_ADVANCE),
  getAll
)

export default router