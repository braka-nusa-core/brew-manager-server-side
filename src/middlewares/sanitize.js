// ============================================================
// middlewares/sanitize.js
// Request sanitization against NoSQL injection and XSS.
//
// Design decisions:
//   - express-mongo-sanitize strips keys containing '$' or '.'
//     from req.body, req.query, and req.params before they
//     reach controllers. This prevents MongoDB operator injection
//     (e.g. { "email": { "$gt": "" } } login bypass attacks).
//
//   - xss-clean sanitizes HTML entities from string values,
//     preventing stored XSS when data is later rendered in a
//     browser. Applied after mongo-sanitize so both run.
//
//   - Both are applied as early middleware in app.js — after
//     body parsing but before routes.
//
//   - Note: sanitization is a defense-in-depth layer. The
//     primary XSS defense is the frontend not rendering raw
//     HTML. The primary injection defense is using Mongoose
//     schemas with typed fields. These middleware are the
//     second line of defense.
// ============================================================

import mongoSanitize from 'express-mongo-sanitize'
import xss           from 'xss-clean'

/**
 * Strips MongoDB operator keys ($, .) from req.body/query/params.
 * Prevents NoSQL injection attacks.
 */
export const mongoSanitizeMiddleware = mongoSanitize({
  replaceWith: '_',      // replace $ with _ rather than removing the key entirely
  onSanitize: ({ req, key }) => {
    // Log sanitization events for security audit trail
    console.warn(`[SECURITY] Sanitized suspicious key '${key}' from ${req.method} ${req.path}`)
  },
})

/**
 * Sanitizes HTML/script tags from string values in req.body/query.
 * Prevents stored XSS payloads from being persisted to the DB.
 */
export const xssSanitizeMiddleware = xss()
