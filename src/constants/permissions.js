// ============================================================
// constants/permissions.js
// v1.1 — Phase 1 extension: MANAGE_PRODUCTS, VIEW_PRODUCTS,
//         MANAGE_CUPS, VIEW_CUPS added.
// ============================================================

export const ROLES = {
  SUPER_ADMIN:  'super_admin',
  TENANT_ADMIN: 'tenant_admin',
  MANAGER:      'manager',
  CASHIER:      'cashier',
}

export const PERMISSIONS = {
  // Tenant
  MANAGE_TENANTS:    'manage:tenants',

  // Outlet
  MANAGE_OUTLETS:    'manage:outlets',
  VIEW_OUTLETS:      'view:outlets',

  // Users
  MANAGE_USERS:      'manage:users',
  VIEW_USERS:        'view:users',

  // Employees
  MANAGE_EMPLOYEES:  'manage:employees',
  VIEW_EMPLOYEES:    'view:employees',

  // Attendance
  MANAGE_ATTENDANCE: 'manage:attendance',
  RECORD_ATTENDANCE: 'record:attendance',
  VIEW_ATTENDANCE:   'view:attendance',

  // Sales
  MANAGE_SALES:      'manage:sales',
  VIEW_SALES:        'view:sales',

  // Expenses
  MANAGE_EXPENSES:   'manage:expenses',
  VIEW_EXPENSES:     'view:expenses',

  // Payroll
  MANAGE_PAYROLL:    'manage:payroll',
  VIEW_PAYROLL:      'view:payroll',

  // Dashboard
  VIEW_DASHBOARD:    'view:dashboard',

  // Products (Phase 1 addition)
  MANAGE_PRODUCTS:   'manage:products',
  VIEW_PRODUCTS:     'view:products',

  // Cup Records (Phase 1 addition)
  MANAGE_CUPS:       'manage:cups',
  VIEW_CUPS:         'view:cups',

  // Raw Materials (Phase 5a addition)
  MANAGE_RAW_MATERIALS: 'manage:raw_materials',
  VIEW_RAW_MATERIALS:   'view:raw_materials',

  // Bikes (Phase 6B addition)
  MANAGE_BIKES: 'manage:bikes',
  VIEW_BIKES:   'view:bikes',
}

export const ROLE_PERMISSIONS = {
  // super_admin gets everything automatically
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
    PERMISSIONS.MANAGE_PRODUCTS,
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.MANAGE_CUPS,
    PERMISSIONS.VIEW_CUPS,
    PERMISSIONS.MANAGE_RAW_MATERIALS,
    PERMISSIONS.VIEW_RAW_MATERIALS,
    PERMISSIONS.MANAGE_BIKES,
    PERMISSIONS.VIEW_BIKES,
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
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.MANAGE_CUPS,
    PERMISSIONS.VIEW_CUPS,
    PERMISSIONS.VIEW_RAW_MATERIALS,
    PERMISSIONS.MANAGE_BIKES,
    PERMISSIONS.VIEW_BIKES,
  ],

  // Cashier: NO attendance access — attendance is manager/admin only.
  // Cashier CAN manage cups (record daily distributions) and view products.
  [ROLES.CASHIER]: [
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.MANAGE_SALES,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.MANAGE_CUPS,
    PERMISSIONS.VIEW_CUPS,
    PERMISSIONS.VIEW_RAW_MATERIALS,
    PERMISSIONS.VIEW_BIKES,
  ],
}