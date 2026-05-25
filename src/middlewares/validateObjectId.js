// ============================================================
// middlewares/validateObjectId.js
// Reusable middleware factory that validates MongoDB ObjectId
// route parameters before they reach the controller or service.
//
// Problem solved:
//   Without this, an invalid ObjectId like "/employees/not-an-id"
//   causes Mongoose to throw a CastError deep in the service,
//   which the error middleware handles as a 500 unless caught.
//   This middleware catches it at the route layer with a clean 400.
//
// Usage:
//   router.get('/:employeeId',
//     validateObjectId('employeeId'),
//     authorize(...),
//     controller.getOne
//   )
//
//   // Validate multiple params at once:
//   router.get('/:tenantId/outlets/:outletId',
//     validateObjectId('tenantId', 'outletId'),
//     ...
//   )
// ============================================================

import mongoose from 'mongoose'
import { errorResponse } from '../utils/apiResponse.js'

/**
 * Middleware factory — validates one or more route params are valid ObjectIds.
 *
 * @param {...string} paramNames - names of req.params fields to validate
 * @returns {Function} Express middleware
 */
const validateObjectId = (...paramNames) => (req, res, next) => {
  for (const param of paramNames) {
    const value = req.params[param]

    if (value && !mongoose.Types.ObjectId.isValid(value)) {
      return res
        .status(400)
        .json(errorResponse(`Invalid ID format for parameter '${param}'`, 400))
    }
  }

  next()
}

export default validateObjectId
