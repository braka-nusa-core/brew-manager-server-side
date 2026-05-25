// ============================================================
// utils/apiResponse.js
// Enforces consistent JSON response shape across all endpoints.
//
// Rules:
//   - Controllers NEVER write raw res.json({}) directly.
//   - All success responses use successResponse().
//   - All error responses in controllers use errorResponse().
//   - The global error middleware uses its own format but
//     follows the same shape.
//
// Shapes:
//   Success: { success: true,  message, data }
//   Error:   { success: false, message, errors[], code }
// ============================================================

/**
 * Builds a standardized success response body.
 *
 * @param {string} message
 * @param {*} data
 * @returns {Object}
 */
export const successResponse = (message, data = null) => ({
  success: true,
  message,
  data,
})

/**
 * Builds a standardized error response body.
 * Used by controllers for validation rejections.
 * The global error middleware uses a similar shape.
 *
 * @param {string}   message
 * @param {number}   [code=400]
 * @param {string[]} [errors=[]]
 * @returns {Object}
 */
export const errorResponse = (message, code = 400, errors = []) => ({
  success: false,
  message,
  errors,
  code,
})
