// ============================================================
// middlewares/error.middleware.js
// Global error handler — last middleware in app.js.
//
// Handles:
//   1. ApiError instances (operational errors from services)
//   2. Mongoose ValidationError
//   3. Mongoose CastError (invalid ObjectId)
//   4. MongoDB duplicate key error (code 11000)
//   5. JWT errors (TokenExpiredError, JsonWebTokenError)
//   6. Unknown errors (500 — message NOT surfaced in production)
//
// Rules:
//   - Stack traces are NEVER sent to the client.
//   - In production, unknown errors return a generic message.
//   - In development, unknown errors include the raw message
//     for debugging.
//   - All responses follow the standard error shape.
// ============================================================

import logger from '../utils/logger.js'
import ApiError from '../utils/ApiError.js'
import { env } from '../config/env.js'

const IS_PROD = env.NODE_ENV === 'production'

/**
 * Centralized Express error handling middleware.
 * Must be registered LAST in app.js.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
// eslint-disable-next-line no-unused-vars
const errorMiddleware = (err, req, res, next) => {
  // Log every error internally — production logs message only,
  // development logs full stack
  logger.error(`${req.method} ${req.originalUrl} → ${err.message}`, {
    statusCode: err.statusCode ?? 500,
    stack:      IS_PROD ? undefined : err.stack,
  })

  // ── 1. Operational errors (ApiError) ─────────────────────
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors:  err.errors ?? [],
      code:    err.statusCode,
    })
  }

  // ── 2. Mongoose ValidationError ──────────────────────────
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message)
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
      code:    400,
    })
  }

  // ── 3. Mongoose CastError (invalid ObjectId) ─────────────
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    return res.status(400).json({
      success: false,
      message: `Invalid ID format for field '${err.path}'`,
      errors:  [],
      code:    400,
    })
  }

  // ── 4. MongoDB Duplicate Key (11000) ─────────────────────
  if (err.code === 11000) {
    const fields = Object.keys(err.keyPattern ?? {}).join(', ')
    return res.status(409).json({
      success: false,
      message: `Duplicate entry — a record with this ${fields} already exists`,
      errors:  [],
      code:    409,
    })
  }

  // ── 5. JWT errors ─────────────────────────────────────────
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Access token has expired',
      errors:  [],
      code:    401,
    })
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Access token is invalid',
      errors:  [],
      code:    401,
    })
  }

  // ── 6. Service-layer errors without ApiError ──────────────
  // Errors thrown with a statusCode property but not using ApiError
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors:  [],
      code:    err.statusCode,
    })
  }

  // ── 7. Unknown / unexpected errors ───────────────────────
  // Never surface internal details in production
  return res.status(500).json({
    success: false,
    message: IS_PROD
      ? 'An unexpected error occurred. Please try again later.'
      : err.message,
    errors: [],
    code:   500,
  })
}

export default errorMiddleware
