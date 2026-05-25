// ============================================================
// app.js
// Express application setup.
// Responsible for middleware registration and route mounting.
//
// MIDDLEWARE ORDER (mandatory):
//   1. helmet          — security headers (before any response)
//   2. cors            — CORS policy
//   3. cookieParser    — parse cookies (needed for refresh token)
//   4. apiRateLimiter  — general rate limit (before body parsing)
//   5. express.json    — body parsing
//   6. sanitize        — NoSQL injection + XSS (after body parsing)
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
import { apiRateLimiter, authRateLimiter } from './middlewares/rateLimiter.js'
import { mongoSanitizeMiddleware, xssSanitizeMiddleware } from './middlewares/sanitize.js'
import errorMiddleware    from './middlewares/error.middleware.js'
import notFoundMiddleware from './middlewares/notFound.middleware.js'

// ── Route imports ─────────────────────────────────────────────
import authRoutes       from './modules/auth/auth.routes.js'
import employeeRoutes   from './modules/employee/employee.routes.js'
import attendanceRoutes from './modules/attendance/attendance.routes.js'
import salesRoutes      from './modules/sales/sales.routes.js'
import expenseRoutes    from './modules/expense/expense.routes.js'
import payrollRoutes    from './modules/payroll/payroll.routes.js'
import dashboardRoutes  from './modules/dashboard/dashboard.routes.js'
import tenantRoutes from './modules/tenant/tenant.routes.js'
import outletRoutes from './modules/outlet/outlet.routes.js'

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
// Required for req.cookies.refreshToken in auth.controller.js
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
app.use('/api/v1/employees',  employeeRoutes)
app.use('/api/v1/attendance', attendanceRoutes)
app.use('/api/v1/sales',      salesRoutes)
app.use('/api/v1/expenses',   expenseRoutes)
app.use('/api/v1/payroll',    payrollRoutes)
app.use('/api/v1/dashboard',  dashboardRoutes)
app.use('/api/v1/tenants', tenantRoutes)
app.use('/api/v1/outlets', outletRoutes)

// ── 9. 404 Handler ────────────────────────────────────────────
app.use(notFoundMiddleware)

// ── 10. Global Error Handler ──────────────────────────────────
app.use(errorMiddleware)

export default app
