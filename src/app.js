// ============================================================
// app.js
// Express application setup.
//
// MIDDLEWARE ORDER (mandatory):
//   1. helmet          — security headers
//   2. cors            — CORS policy
//   3. cookieParser    — parse httpOnly refresh cookie
//   4. apiRateLimiter  — general rate limit
//   5. express.json    — body parsing
//   6. sanitize        — NoSQL injection + XSS
//   7. httpLogger      — request logging
//   8. routes          — business routes
//   9. notFound        — 404 handler
//  10. errorMiddleware — global error handler (last)
// ============================================================

import express      from 'express'
import helmet       from 'helmet'
import cors         from 'cors'
import cookieParser from 'cookie-parser'

import { env }        from './config/env.js'
import { httpLogger } from './utils/logger.js'
import { apiRateLimiter, authRateLimiter, riderPortalRateLimiter } from './middlewares/rateLimiter.js'
import { mongoSanitizeMiddleware, xssSanitizeMiddleware } from './middlewares/sanitize.js'
import errorMiddleware    from './middlewares/error.middleware.js'
import notFoundMiddleware from './middlewares/notFound.middleware.js'

// ── Route imports ─────────────────────────────────────────────
import authRoutes       from './modules/auth/auth.routes.js'
import tenantRoutes     from './modules/tenant/tenant.routes.js'
import outletRoutes     from './modules/outlet/outlet.routes.js'
import userRoutes       from './modules/user/user.routes.js'
import employeeRoutes   from './modules/employee/employee.routes.js'
import attendanceRoutes from './modules/attendance/attendance.routes.js'
import salesRoutes      from './modules/sales/sales.routes.js'
import expenseRoutes    from './modules/expense/expense.routes.js'
import payrollRoutes    from './modules/payroll/payroll.routes.js'
import dashboardRoutes  from './modules/dashboard/dashboard.routes.js'
import productRoutes    from './modules/product/product.routes.js'
import productRecipeRoutes from './modules/productRecipe/productRecipe.routes.js'
import cupRoutes        from './modules/cup/cup.routes.js'
import rawMaterialRoutes from './modules/rawMaterial/rawMaterial.routes.js'
import riderPortalRoutes  from './modules/riderPortal/riderPortal.routes.js'
import bikeRoutes         from './modules/bike/bike.routes.js'
import bikeAssignmentRoutes from './modules/bikeAssignment/bikeAssignment.routes.js'
import { damageReportRouter, repairRecordRouter } from './modules/bikeMaintenance/bikeMaintenance.routes.js'
import notificationRoutes from './modules/notification/notification.routes.js'

const app = express()

// ── 1. Security Headers ───────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
)

// ── 2. CORS ───────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (env.CORS_ORIGINS.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS: Origin '${origin}' not allowed`))
      }
    },
    credentials:          true,
    methods:              ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders:       ['Content-Type', 'Authorization'],
    exposedHeaders:       ['RateLimit-Limit', 'RateLimit-Remaining'],
    optionsSuccessStatus: 200,
  })
)

// ── 3. Cookie Parser ──────────────────────────────────────────
app.use(cookieParser())

// ── 4. General Rate Limiting ──────────────────────────────────
app.use('/api/', apiRateLimiter)

// ── 5. Body Parsing ───────────────────────────────────────────
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true, limit: '10kb' }))

// ── 6. Request Sanitization ───────────────────────────────────
app.use(mongoSanitizeMiddleware)
app.use(xssSanitizeMiddleware)

// ── 7. HTTP Request Logging ───────────────────────────────────
app.use(httpLogger)

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success:     true,
    message:     'BrewManager API is running',
    environment: env.NODE_ENV,
    timestamp:   new Date().toISOString(),
  })
})

// ── 8. API Routes ─────────────────────────────────────────────
app.use('/api/v1/auth',       authRateLimiter, authRoutes)
app.use('/api/v1/tenants',    tenantRoutes)
app.use('/api/v1/outlets',    outletRoutes)
app.use('/api/v1/users',      userRoutes)
app.use('/api/v1/employees',  employeeRoutes)
app.use('/api/v1/attendance', attendanceRoutes)
app.use('/api/v1/sales',      salesRoutes)
app.use('/api/v1/expenses',   expenseRoutes)
app.use('/api/v1/payroll',    payrollRoutes)
app.use('/api/v1/dashboard',  dashboardRoutes)
app.use('/api/v1/products',   productRoutes)
app.use('/api/v1/products/:productId/recipe', productRecipeRoutes)
app.use('/api/v1/cups',       cupRoutes)
app.use('/api/v1/raw-materials', rawMaterialRoutes)

// ── Public Routes (Phase 6A) ──────────────────────────────────
// NOT under /api/v1 — deliberate, distinct public namespace.
// riderPortalRateLimiter stacks on top of the general apiRateLimiter
// applied at line 77, exactly the same pattern as authRateLimiter
// stacking on /api/v1/auth above. No authenticate/tenantGuard —
// the portal token itself is the access credential.
app.use('/api/public/rider', riderPortalRateLimiter, riderPortalRoutes)

// ── Bike Management (Phase 6B) ────────────────────────────────
app.use('/api/v1/bikes',               bikeRoutes)
app.use('/api/v1/bike-assignments',    bikeAssignmentRoutes)
app.use('/api/v1/bike-damage-reports', damageReportRouter)
app.use('/api/v1/bike-repair-records', repairRecordRouter)

// ── Notification Center ───────────────────────────────────────
// authenticate-only, no tenantGuard/authorize() — see
// notification.routes.js header note.
app.use('/api/v1/notifications', notificationRoutes)

// ── 9. 404 Handler ────────────────────────────────────────────
app.use(notFoundMiddleware)

// ── 10. Global Error Handler ──────────────────────────────────
app.use(errorMiddleware)

export default app