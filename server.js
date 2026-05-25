// ============================================================
// server.js
// Application entry point.
//
// Startup order (mandatory):
//   1. validateEnv()   — crash fast if config is broken
//   2. connectDB()     — no server without a DB
//   3. app.listen()    — only start accepting traffic when ready
//
// This file intentionally contains no Express logic.
// All Express setup is in app.js.
// ============================================================

import { validateEnv, env } from './src/config/env.js'
import connectDB             from './src/config/db.js'
import app                   from './src/app.js'
import logger                from './src/utils/logger.js'

// ── Step 1: Validate environment ──────────────────────────────
validateEnv()

// ── Step 2: Connect to MongoDB ────────────────────────────────
await connectDB()

// ── Step 3: Start HTTP server ──────────────────────────────────
const server = app.listen(env.PORT, () => {
  logger.info(`BrewManager API started`, {
    port:        env.PORT,
    environment: env.NODE_ENV,
    url:         `http://localhost:${env.PORT}`,
  })
})

// ── Graceful shutdown ─────────────────────────────────────────
// Allows in-flight requests to complete before closing.

const shutdown = (signal) => {
  logger.warn(`${signal} received — shutting down gracefully...`)

  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })

  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit')
    process.exit(1)
  }, 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

// ── Unhandled rejection safety net ────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message ?? reason,
  })
  shutdown('unhandledRejection')
})
