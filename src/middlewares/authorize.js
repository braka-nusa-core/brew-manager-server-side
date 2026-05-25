// ============================================================
// middlewares/authorize.js
// Permission-based route guard.
// A middleware factory — returns a middleware function
// configured with the required permission(s).
//
// Responsibilities:
//   ✅ Accept one or more required permissions
//   ✅ Read req.user.role (set by authenticate.js)
//   ✅ Check role against ROLE_PERMISSIONS map
//   ✅ Allow if role has ANY of the required permissions
//   ✅ Reject with 403 if not authorized
//   ❌ Does NOT verify JWT
//   ❌ Does NOT handle tenant isolation
//   ❌ Does NOT query the database
//
// Usage:
//   router.get('/employees',
//     authenticate,
//     tenantGuard,
//     authorize(PERMISSIONS.VIEW_EMPLOYEES),
//     employeeController.getAll
//   )
//
//   // Multiple permissions (any match grants access):
//   authorize(PERMISSIONS.MANAGE_EMPLOYEES, PERMISSIONS.VIEW_EMPLOYEES)
// ============================================================

import { ROLE_PERMISSIONS } from '../constants/permissions.js'
import { errorResponse } from '../utils/apiResponse.js'

/**
 * authorize — middleware factory
 *
 * @param {...string} requiredPermissions
 *   One or more permission strings from PERMISSIONS constant.
 *   Access is granted if the user's role has AT LEAST ONE
 *   of the listed permissions.
 *
 * @returns {Function} Express middleware
 */
const authorize = (...requiredPermissions) => {
  return (req, res, next) => {
    const { role } = req.user

    if (!role) {
      return res
        .status(403)
        .json(errorResponse('Forbidden — role is missing from token', 403))
    }

    const rolePermissions = ROLE_PERMISSIONS[role] ?? []

    // Check if the user's role satisfies at least one required permission
    const hasPermission = requiredPermissions.some((permission) =>
      rolePermissions.includes(permission)
    )

    if (!hasPermission) {
      return res
        .status(403)
        .json(
          errorResponse(
            `Forbidden — role '${role}' does not have required permission`,
            403
          )
        )
    }

    next()
  }
}

export default authorize
