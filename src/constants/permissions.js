// ============================================================
// constants/permissions.js
// Single source of truth for all system permissions.
// Used by authorize.js middleware — never hardcode strings
// in routes or controllers.
// ============================================================

export const ROLES = {
  SUPER_ADMIN:    'super_admin',
  TENANT_ADMIN:   'tenant_admin',
  MANAGER:        'manager',
  CASHIER:        'cashier',
}

export const PERMISSIONS = {
  // Tenant management
  MANAGE_TENANTS:     'manage:tenants',

  // Outlet management
  MANAGE_OUTLETS:     'manage:outlets',
  VIEW_OUTLETS:       'view:outlets',

  // User management
  MANAGE_USERS:       'manage:users',
  VIEW_USERS:         'view:users',

  // Employee management
  MANAGE_EMPLOYEES:   'manage:employees',
  VIEW_EMPLOYEES:     'view:employees',

  // Attendance
  // RECORD_ATTENDANCE is the route-level permission.
  // MANAGE_ATTENDANCE is the broader admin-level permission.
  // Cashiers have NEITHER — attendance is manager/admin only.
  MANAGE_ATTENDANCE:  'manage:attendance',
  RECORD_ATTENDANCE:  'record:attendance',
  VIEW_ATTENDANCE:    'view:attendance',

  // Sales
  MANAGE_SALES:       'manage:sales',
  VIEW_SALES:         'view:sales',

  // Expenses
  MANAGE_EXPENSES:    'manage:expenses',
  VIEW_EXPENSES:      'view:expenses',

  // Payroll
  MANAGE_PAYROLL:     'manage:payroll',
  VIEW_PAYROLL:       'view:payroll',

  // Dashboard
  VIEW_DASHBOARD:     'view:dashboard',
}

export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),

  [ROLES.TENANT_ADMIN]: [
    PERMISSIONS.MANAGE_OUTLETS,
    PERMISSIONS.VIEW_OUTLETS,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.MANAGE_EMPLOYEES,
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.MANAGE_ATTENDANCE,
    PERMISSIONS.RECORD_ATTENDANCE,
    PERMISSIONS.VIEW_ATTENDANCE,
    PERMISSIONS.MANAGE_SALES,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.MANAGE_EXPENSES,
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.MANAGE_PAYROLL,
    PERMISSIONS.VIEW_PAYROLL,
    PERMISSIONS.VIEW_DASHBOARD,
  ],

  [ROLES.MANAGER]: [
    PERMISSIONS.VIEW_OUTLETS,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.MANAGE_EMPLOYEES,
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.MANAGE_ATTENDANCE,
    PERMISSIONS.RECORD_ATTENDANCE,
    PERMISSIONS.VIEW_ATTENDANCE,
    PERMISSIONS.MANAGE_SALES,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.MANAGE_EXPENSES,
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.VIEW_PAYROLL,
    PERMISSIONS.VIEW_DASHBOARD,
  ],

  // Cashier: NO attendance access — attendance is admin/manager only.
  [ROLES.CASHIER]: [
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.MANAGE_SALES,
    PERMISSIONS.VIEW_SALES,
  ],
}
