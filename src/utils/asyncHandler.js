// ============================================================
// utils/asyncHandler.js
// Eliminates repetitive try/catch in every controller.
//
// Usage:
//   export const myController = asyncHandler(async (req, res) => {
//     // any thrown error or rejected promise is forwarded to
//     // the global error.middleware.js via next(err)
//   })
// ============================================================

/**
 * Wraps an async Express handler.
 * If the handler throws or rejects, the error is passed to next()
 * which forwards it to the centralized error middleware.
 *
 * @param {Function} fn - async (req, res, next) => void
 * @returns {Function} Express middleware
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

export default asyncHandler
