// ============================================================
// modules/dashboard/dashboard.routes.js
// Route definitions for the dashboard analytics module.
// Mounted at: /api/v1/dashboard
//
// Authorization:
//   All dashboard routes require VIEW_DASHBOARD permission.
//   Cashiers do NOT have this permission.
//   Manager access is outlet-scoped inside the service layer.
//
// Query parameters supported on all endpoints:
//   startDate, endDate, outletId (where applicable)
// ============================================================

import { Router } from 'express'
import authenticate from '../../middlewares/authenticate.js'
import tenantGuard  from '../../middlewares/tenantGuard.js'
import authorize    from '../../middlewares/authorize.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  summary,
  salesTrend,
  expenseTrend,
  attendanceSummary,
  employeePerformance,
  productMargins,
  dailyPaymentSummary,
} from './dashboard.controller.js'

const router = Router()

router.use(authenticate)
router.use(tenantGuard)
router.use(authorize(PERMISSIONS.VIEW_DASHBOARD))

router.get('/summary',              summary)
router.get('/sales-trend',          salesTrend)
router.get('/expense-trend',        expenseTrend)
router.get('/attendance-summary',   attendanceSummary)
router.get('/employee-performance', employeePerformance)
router.get('/product-margins',      productMargins)
router.get('/daily-payment-summary', dailyPaymentSummary)   // Phase 3.3

export default router