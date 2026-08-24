// ============================================================
// modules/employeeWallet/employeeWallet.routes.js
// Mounted at: /api/v1/wallet
//
// Endpoints:
//   GET  /balance?employeeId=...
//   GET  /history?employeeId=...
//   GET  /summary?employeeId=...   — Phase 2.3
//   POST /withdrawal
//   POST /adjustment
//   POST /manual                   — Phase 2.4
//
// Authorization:
//   MANAGE_EMPLOYEE_WALLET → withdrawal, adjustment, manual
//   VIEW_EMPLOYEE_WALLET   → balance, history, summary (MANAGE also satisfies)
// ============================================================

import { Router }      from 'express'
import authenticate    from '../../middlewares/authenticate.js'
import tenantGuard     from '../../middlewares/tenantGuard.js'
import authorize       from '../../middlewares/authorize.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  getBalance,
  getHistory,
  getSummary,
  postWithdrawal,
  postAdjustment,
  postManual,
} from './employeeWallet.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)

router.get(
  '/balance',
  authorize(PERMISSIONS.VIEW_EMPLOYEE_WALLET, PERMISSIONS.MANAGE_EMPLOYEE_WALLET),
  getBalance
)

router.get(
  '/history',
  authorize(PERMISSIONS.VIEW_EMPLOYEE_WALLET, PERMISSIONS.MANAGE_EMPLOYEE_WALLET),
  getHistory
)

router.get(
  '/summary',
  authorize(PERMISSIONS.VIEW_EMPLOYEE_WALLET, PERMISSIONS.MANAGE_EMPLOYEE_WALLET),
  getSummary
)

router.post(
  '/withdrawal',
  authorize(PERMISSIONS.MANAGE_EMPLOYEE_WALLET),
  postWithdrawal
)

router.post(
  '/adjustment',
  authorize(PERMISSIONS.MANAGE_EMPLOYEE_WALLET),
  postAdjustment
)

router.post(
  '/manual',
  authorize(PERMISSIONS.MANAGE_EMPLOYEE_WALLET),
  postManual
)

export default router