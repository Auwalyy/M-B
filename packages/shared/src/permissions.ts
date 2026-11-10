import type { RoleKey, RoleScope } from './enums';

/**
 * Every permission in the system. The API always enforces these checks;
 * the web app uses the same list only to decide what to show.
 */
export const PERMISSIONS = {
  // Branches
  BRANCHES_READ: 'branches:read',
  BRANCHES_CREATE: 'branches:create',
  BRANCHES_UPDATE: 'branches:update',
  BRANCHES_UPDATE_PROFILE: 'branches:update-profile',
  BRANCHES_DEACTIVATE: 'branches:deactivate',
  // Users & roles
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DEACTIVATE: 'users:deactivate',
  USERS_RESET_PASSWORD: 'users:reset-password',
  USERS_ASSIGN_BRANCHES: 'users:assign-branches',
  USERS_GRANT_ACCESS: 'users:grant-access',
  ROLES_READ: 'roles:read',
  ROLES_UPDATE: 'roles:update',
  // Company settings & audit
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',
  AUDIT_READ: 'audit:read',
  AUDIT_READ_LOGINS: 'audit:read-logins',
  // Catalog
  PRODUCTS_READ: 'products:read',
  PRODUCTS_WRITE: 'products:write',
  CATEGORIES_WRITE: 'categories:write',
  BRANDS_WRITE: 'brands:write',
  // Inventory
  INVENTORY_READ: 'inventory:read',
  INVENTORY_STOCK_IN: 'inventory:stock-in',
  INVENTORY_STOCK_OUT: 'inventory:stock-out',
  INVENTORY_UPDATE: 'inventory:update',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_APPROVE_ADJUSTMENT: 'inventory:approve-adjustment',
  INVENTORY_TRANSFER_REQUEST: 'inventory:transfer-request',
  INVENTORY_TRANSFER_APPROVE: 'inventory:transfer-approve',
  INVENTORY_OVERRIDE: 'inventory:override',
  INVENTORY_READ_COST: 'inventory:read-cost',
  // Customers & enquiries
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_SEGMENTS: 'customers:segments',
  ENQUIRIES_READ: 'enquiries:read',
  ENQUIRIES_MANAGE: 'enquiries:manage',
  // Orders & reservations
  ORDERS_READ: 'orders:read',
  ORDERS_READ_ALL_BRANCH: 'orders:read-all-branch',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE_STATUS: 'orders:update-status',
  ORDERS_CANCEL: 'orders:cancel',
  RESERVATIONS_READ: 'reservations:read',
  RESERVATIONS_CREATE: 'reservations:create',
  RESERVATIONS_REVIEW: 'reservations:review',
  // Payments & delivery
  PAYMENTS_READ: 'payments:read',
  PAYMENTS_RECORD: 'payments:record',
  PAYMENTS_CONFIRM: 'payments:confirm',
  PAYMENTS_REFUND: 'payments:refund',
  DELIVERY_READ: 'delivery:read',
  DELIVERY_MANAGE: 'delivery:manage',
  DELIVERY_ZONES_MANAGE: 'delivery-zones:manage',
  // Promotions & reports
  PROMOTIONS_MANAGE: 'promotions:manage',
  REPORTS_READ: 'reports:read',
  REPORTS_FINANCIAL: 'reports:financial',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as [Permission, ...Permission[]];

const P = PERMISSIONS;

/** Human-readable grouping used by the role editor in the admin UI. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: 'Branches',
    permissions: [P.BRANCHES_READ, P.BRANCHES_CREATE, P.BRANCHES_UPDATE, P.BRANCHES_UPDATE_PROFILE, P.BRANCHES_DEACTIVATE],
  },
  {
    label: 'Staff & roles',
    permissions: [
      P.USERS_READ, P.USERS_CREATE, P.USERS_UPDATE, P.USERS_DEACTIVATE, P.USERS_RESET_PASSWORD,
      P.USERS_ASSIGN_BRANCHES, P.USERS_GRANT_ACCESS, P.ROLES_READ, P.ROLES_UPDATE,
    ],
  },
  {
    label: 'Settings & audit',
    permissions: [P.SETTINGS_READ, P.SETTINGS_UPDATE, P.AUDIT_READ, P.AUDIT_READ_LOGINS],
  },
  {
    label: 'Catalog',
    permissions: [P.PRODUCTS_READ, P.PRODUCTS_WRITE, P.CATEGORIES_WRITE, P.BRANDS_WRITE],
  },
  {
    label: 'Inventory',
    permissions: [
      P.INVENTORY_READ, P.INVENTORY_STOCK_IN, P.INVENTORY_STOCK_OUT, P.INVENTORY_UPDATE, P.INVENTORY_ADJUST,
      P.INVENTORY_APPROVE_ADJUSTMENT, P.INVENTORY_TRANSFER_REQUEST, P.INVENTORY_TRANSFER_APPROVE,
      P.INVENTORY_OVERRIDE, P.INVENTORY_READ_COST,
    ],
  },
  {
    label: 'Customers & enquiries',
    permissions: [
      P.CUSTOMERS_READ, P.CUSTOMERS_CREATE, P.CUSTOMERS_UPDATE, P.CUSTOMERS_SEGMENTS,
      P.ENQUIRIES_READ, P.ENQUIRIES_MANAGE,
    ],
  },
  {
    label: 'Orders & reservations',
    permissions: [
      P.ORDERS_READ, P.ORDERS_READ_ALL_BRANCH, P.ORDERS_CREATE, P.ORDERS_UPDATE_STATUS, P.ORDERS_CANCEL,
      P.RESERVATIONS_READ, P.RESERVATIONS_CREATE, P.RESERVATIONS_REVIEW,
    ],
  },
  {
    label: 'Payments & delivery',
    permissions: [
      P.PAYMENTS_READ, P.PAYMENTS_RECORD, P.PAYMENTS_CONFIRM, P.PAYMENTS_REFUND,
      P.DELIVERY_READ, P.DELIVERY_MANAGE, P.DELIVERY_ZONES_MANAGE,
    ],
  },
  {
    label: 'Promotions & reports',
    permissions: [P.PROMOTIONS_MANAGE, P.REPORTS_READ, P.REPORTS_FINANCIAL],
  },
];

/** Permissions only company-scoped roles may hold, whatever the role editor says. */
export const COMPANY_ONLY_PERMISSIONS: Permission[] = [
  P.BRANCHES_CREATE,
  P.BRANCHES_UPDATE,
  P.BRANCHES_DEACTIVATE,
  P.USERS_ASSIGN_BRANCHES,
  P.USERS_GRANT_ACCESS,
  P.ROLES_READ,
  P.ROLES_UPDATE,
  P.SETTINGS_READ,
  P.SETTINGS_UPDATE,
  P.AUDIT_READ_LOGINS,
  P.PRODUCTS_WRITE,
  P.CATEGORIES_WRITE,
  P.BRANDS_WRITE,
  P.INVENTORY_TRANSFER_APPROVE,
  P.PROMOTIONS_MANAGE,
];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: Permission[];
}

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Company owner. Full control of every branch and setting.',
    scope: 'company',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'BRANCH_ADMIN',
    name: 'Branch Administrator',
    description: 'Manages the operations of the branches assigned to them.',
    scope: 'branch',
    permissions: [
      P.BRANCHES_READ, P.BRANCHES_UPDATE_PROFILE,
      P.USERS_READ, P.USERS_CREATE, P.USERS_UPDATE, P.USERS_DEACTIVATE, P.USERS_RESET_PASSWORD,
      P.AUDIT_READ,
      P.PRODUCTS_READ,
      P.INVENTORY_READ, P.INVENTORY_STOCK_IN, P.INVENTORY_STOCK_OUT, P.INVENTORY_UPDATE, P.INVENTORY_ADJUST,
      P.INVENTORY_APPROVE_ADJUSTMENT, P.INVENTORY_TRANSFER_REQUEST, P.INVENTORY_READ_COST,
      P.CUSTOMERS_READ, P.CUSTOMERS_CREATE, P.CUSTOMERS_UPDATE, P.CUSTOMERS_SEGMENTS,
      P.ENQUIRIES_READ, P.ENQUIRIES_MANAGE,
      P.ORDERS_READ, P.ORDERS_READ_ALL_BRANCH, P.ORDERS_CREATE, P.ORDERS_UPDATE_STATUS, P.ORDERS_CANCEL,
      P.RESERVATIONS_READ, P.RESERVATIONS_CREATE, P.RESERVATIONS_REVIEW,
      P.PAYMENTS_READ, P.PAYMENTS_RECORD, P.PAYMENTS_CONFIRM, P.PAYMENTS_REFUND,
      P.DELIVERY_READ, P.DELIVERY_MANAGE, P.DELIVERY_ZONES_MANAGE,
      P.REPORTS_READ, P.REPORTS_FINANCIAL,
    ],
  },
  {
    key: 'SALES_STAFF',
    name: 'Sales Staff',
    description: 'Serves customers and creates orders and reservations at their branch.',
    scope: 'branch',
    permissions: [
      P.BRANCHES_READ,
      P.PRODUCTS_READ,
      P.INVENTORY_READ, P.INVENTORY_ADJUST,
      P.CUSTOMERS_READ, P.CUSTOMERS_CREATE,
      P.ENQUIRIES_READ, P.ENQUIRIES_MANAGE,
      P.ORDERS_READ, P.ORDERS_CREATE, P.ORDERS_UPDATE_STATUS,
      P.RESERVATIONS_READ, P.RESERVATIONS_CREATE,
      P.PAYMENTS_READ, P.PAYMENTS_RECORD,
      P.DELIVERY_READ,
    ],
  },
  {
    key: 'CUSTOMER',
    name: 'Customer',
    description: 'Shops online, makes reservations and tracks their own orders.',
    scope: 'self',
    permissions: [],
  },
];

export const PERMISSION_LABELS: Record<Permission, string> = Object.fromEntries(
  ALL_PERMISSIONS.map((p) => {
    const [resource = '', action = ''] = p.split(':');
    const words = `${action} ${resource}`.replace(/-/g, ' ');
    return [p, words.charAt(0).toUpperCase() + words.slice(1)];
  }),
) as Record<Permission, string>;

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
