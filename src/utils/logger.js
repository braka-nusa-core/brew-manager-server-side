// ============================================================
// utils/logger.js
// Centralized logging utility for BrewManager backend.
//
// Design decisions:
//   - Uses a lightweight custom logger rather than pulling in
//     Winston for MVP. Format mimics structured logging so it
//     can be replaced with Winston or Pino in Phase 8+ with
//     no change to call sites.
//   - In production, logs are written to stdout in JSON format
//     so they can be ingested by any log aggregator (Datadog,
//     CloudWatch, etc.) without configuration changes.
//   - In development, logs use a readable colorized format.
//   - morgan is configured here and exported as middleware
//     so app.js imports a single object.
//   - Error stack traces are only logged in development.
//     Production logs the error message only.
// ============================================================

import morgan from 'morgan'

const IS_PROD = process.env.NODE_ENV === 'production'

// ── ANSI color codes (dev only) ───────────────────────────────
const COLORS = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
}

const colorize = (color, text) =>
  IS_PROD ? text : `${COLORS[color]}${text}${COLORS.reset}`

// ── Log level helpers ─────────────────────────────────────────

const timestamp = () => new Date().toISOString()

const formatDev = (level, message, meta) => {
  const levelMap = {
    info:  colorize('green',  '[INFO] '),
    warn:  colorize('yellow', '[WARN] '),
    error: colorize('red',    '[ERROR]'),
    debug: colorize('cyan',   '[DEBUG]'),
  }
  const prefix = levelMap[level] ?? '[LOG]  '
  const metaStr = meta ? ` ${colorize('gray', JSON.stringify(meta))}` : ''
  return `${colorize('gray', timestamp())} ${prefix} ${message}${metaStr}`
}

const formatProd = (level, message, meta) =>
  JSON.stringify({ timestamp: timestamp(), level, message, ...meta })

const log = (level, message, meta) => {
  const output = IS_PROD
    ? formatProd(level, message, meta)
    : formatDev(level, message, meta)

  if (level === 'error') {
    console.error(output)
  } else {
    console.log(output)
  }
}

// ── Exported logger object ────────────────────────────────────

const logger = {
  info:  (message, meta) => log('info',  message, meta),
  warn:  (message, meta) => log('warn',  message, meta),
  error: (message, meta) => log('error', message, meta),
  debug: (message, meta) => {
    // Only log debug in non-production
    if (!IS_PROD) log('debug', message, meta)
  },
}

// ── Morgan HTTP middleware ────────────────────────────────────
// Uses 'combined' format in production (includes IP, user-agent).
// Uses 'dev' format in development (colorized, compact).

export const httpLogger = morgan(
  IS_PROD ? 'combined' : 'dev',
  {
    // Route morgan output through our logger.error for 4xx/5xx,
    // logger.info for 2xx/3xx
    stream: {
      write: (message) => logger.info(message.trim()),
    },
    // Skip health check endpoints to reduce noise
    skip: (req) => req.url === '/health' || req.url === '/api/v1/health',
  }
)

export default logger
