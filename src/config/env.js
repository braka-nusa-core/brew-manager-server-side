// ============================================================
// config/env.js
// Centralized environment variable access with startup validation.
//
// Design decisions:
//   - All process.env reads happen HERE and nowhere else.
//     No scattered process.env usage across the codebase.
//   - validateEnv() is called at startup (server.js) BEFORE
//     the DB connects or the Express app starts.
//   - If any required variable is missing, the process exits
//     immediately with a clear error — no silent misconfiguration.
//   - Defaults are provided only for non-secret, safe values
//     (PORT, NODE_ENV, JWT expiry times).
//   - Secrets (DB URI, JWT secrets) have NO defaults — they
//     must always be explicitly set.
// ============================================================

// ── Required variables (no defaults) ─────────────────────────

const REQUIRED_VARS = [
  'MONGO_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
]

/**
 * Validates that all required environment variables are present.
 * Called once at startup — crashes the process if anything is missing.
 *
 * @throws {Error} If any required variable is missing
 */
export const validateEnv = () => {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key])

  if (missing.length > 0) {
    console.error(
      `[STARTUP ERROR] Missing required environment variables: ${missing.join(', ')}\n` +
      'Check your .env file against .env.example and restart.'
    )
    process.exit(1)
  }
}

// ── Centralized env object ────────────────────────────────────
// All modules import from here — never from process.env directly.

export const env = {
  NODE_ENV:           process.env.NODE_ENV           ?? 'development',
  PORT:               parseInt(process.env.PORT, 10) || 5000,

  MONGO_URI:          process.env.MONGO_URI,

  JWT_ACCESS_SECRET:  process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES  ?? '15m',
  JWT_REFRESH_EXPIRES:process.env.JWT_REFRESH_EXPIRES ?? '7d',

  // CORS — comma-separated allowed origins in production
  // e.g. CORS_ORIGINS=https://app.brewmanager.com,https://admin.brewmanager.com
  CORS_ORIGINS: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'],

  // Frontend base URL — used to construct shareable links (e.g. the
  // Rider Portal URL returned by POST /employees/:id/generate-portal).
  // Phase 6A addition. Non-secret, safe localhost default — same
  // treatment as CORS_ORIGINS above.
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
}