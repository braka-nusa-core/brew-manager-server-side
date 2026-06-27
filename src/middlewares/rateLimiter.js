// ============================================================
// middlewares/rateLimiter.js
// Rate limiting for BrewManager API routes.
//
// Design decisions:
//   - Two tiers: strict (auth) and general (all other routes).
//   - Auth routes get a much tighter window to prevent
//     credential stuffing and brute-force attacks.
//   - General API rate is generous — this is an internal
//     business tool, not a public consumer API.
//   - standardHeaders: true sends RateLimit-* headers per
//     RFC 6585 — useful for frontend to show backoff messages.
//   - legacyHeaders: false removes X-RateLimit-* legacy headers
//     to keep response headers clean.
//   - In production with multiple processes/nodes, a Redis
//     store (express-rate-limit/redis-store) should replace
//     the default in-memory store. This is noted as a Phase 8
//     improvement — in-memory is correct for MVP single-process.
// ============================================================

import rateLimit from 'express-rate-limit'

// ── Auth rate limiter ─────────────────────────────────────────
// 20 requests per 15 minutes per IP on auth endpoints.
// Covers login, refresh-token brute-force scenarios.

export const authRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,   // 15 minutes
  max:             20,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
    code:    429,
  },
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: false,      // count all requests, not just failed ones
})

// ── General API rate limiter ──────────────────────────────────
// 500 requests per 15 minutes per IP on all other routes.
// This is intentionally generous for a business management tool.

export const apiRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,   // 15 minutes
  max:             500,
  message: {
    success: false,
    message: 'Too many requests. Please slow down and try again shortly.',
    code:    429,
  },
  standardHeaders: true,
  legacyHeaders:   false,
})

// ── Rider Portal rate limiter (Phase 6A addition) ─────────────
// 20 requests per 15 minutes per IP on the public rider portal.
//
// This endpoint is unauthenticated and accepts a guessable-format
// credential (the portal token) directly in the URL — the general
// apiRateLimiter's generous 500/15min ceiling (designed for an
// internal business tool, per the design note above) is NOT
// sufficient here. This mirrors authRateLimiter's exact shape,
// since both endpoints share the same threat model: brute-force
// guessing of a secret value with no account lockout.
//
// Stacks ON TOP of apiRateLimiter (mounted in app.js the same way
// authRateLimiter stacks on '/api/v1/auth') — not a replacement.

export const riderPortalRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,   // 15 minutes
  max:             20,
  message: {
    success: false,
    message: 'Too many requests. Please try again in 15 minutes.',
    code:    429,
  },
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: false,      // count all requests, not just failed ones
})