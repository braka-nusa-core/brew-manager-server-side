// ============================================================
// utils/ApiError.js
// Custom error class used across all modules.
//
// Design decisions:
//   - Extends native Error so it works with instanceof checks
//     and stack traces in development.
//   - statusCode is carried on the error — the central error
//     middleware reads it instead of using a separate field.
//   - isOperational flag distinguishes expected business errors
//     (validation, not found, forbidden) from unexpected crashes.
//     Only operational errors get their message surfaced to
//     the client — crashes show a generic 500 message.
//   - Services throw: throw new ApiError(404, 'Not found')
//     Controllers never catch — asyncHandler forwards to middleware.
// ============================================================

class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} message    - Human-readable error message
   * @param {string[]} [errors] - Optional array of validation error details
   */
  constructor(statusCode, message, errors = []) {
    super(message)
    this.statusCode    = statusCode
    this.errors        = errors
    this.isOperational = true // marks this as an expected, handled error
    Error.captureStackTrace(this, this.constructor)
  }
}

export default ApiError
