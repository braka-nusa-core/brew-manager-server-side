// ============================================================
// modules/employeeWallet/employeeWallet.routes.js
// Phase 2.1 — Employee Wallet foundation.
// Phase 2.1 refinement pass:
//   - Mounted at the shorter /api/v1/wallet (was /api/v1/employee-wallets).
//   - GET routes now take employeeId as a query param
//     (?employeeId=...) instead of a /:employeeId path segment —
//     matches how outletId/employeeId filters already work elsewhere
//     in this codebase (e.g. sales.routes.js's GET / with ?employeeId=).
//   - POST routes take employeeId in the body (unchanged pattern,
//     already how sales.routes.js's POST / works).
//
// Endpoints:
//   GET  /balance?employeeId=...    — current derived balance
//   GET  /history?employeeId=...    — paginated ledger history
//   POST /withdrawal                — record a withdrawal (body.employeeId)
//   POST /adjustment                — record a manual signed correction (body.employeeId)
//
// Authorization:
//   MANAGE_EMPLOYEE_WALLET → withdrawal, adjustment
//   VIEW_EMPLOYEE_WALLET   → balance, history (MANAGE also satisfies)
//
// No route for daily_credit in this phase — createDailyCredit() exists
// as a service method only (Phase 2.1 scope: no automation, no manual
// trigger endpoint either, per "do not create automatic daily credits").
//
// employeeId is tenant-validated inside the service layer
// (loadEmployee()), same pattern as sales.service.js's
// validateEmployeeAccess — not duplicated here at the route level.
// validateObjectId middleware isn't used here since it only checks
// req.params, and employeeId now lives in req.query/req.body —
// see employeeWallet.validation.js's validateEmployeeIdQuery /
// validateCreateWithdrawal / validateCreateAdjustment instead.
// ============================================================

import { Router }      from 'express'
import authenticate    from '../../middlewares/authenticate.js'
import tenantGuard     from '../../middlewares/tenantGuard.js'
import authorize       from '../../middlewares/authorize.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  getBalance,
  getHistory,
  postWithdrawal,
  postAdjustment,
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

export default router