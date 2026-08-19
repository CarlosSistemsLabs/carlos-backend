import { PERMISSION_WILDCARD, type PermissionDescriptor } from '../value-objects/permission.js';

/**
 * Catalogue of known RBAC modules, screens and actions plus the default
 * permission matrix for the seeded system roles (Requirement 8.4).
 *
 * These constants are the single source of truth referenced by tenant
 * provisioning (task 27.1) and the seed scripts when bootstrapping a new
 * tenant's roles. They are framework-agnostic so the domain and application
 * layers can import them freely.
 */

/**
 * Known business modules, aligned with the feature modules in the design
 * (`Requirement 12`) and the modules called out for task 9.1. `module` strings
 * stored on permissions SHOULD come from this set, but the `Permission` value
 * object does not enforce it, leaving room for future modules.
 */
export const MODULES = {
  SALES: 'sales',
  PRODUCTS: 'products',
  STOCK: 'stock',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  PURCHASES: 'purchases',
  CASH: 'cash',
  REPORTS: 'reports',
  AI: 'ai',
  ADMINISTRATION: 'administration',
  SETTINGS: 'settings',
} as const;

/** Union of known module identifiers. */
export type ModuleName = (typeof MODULES)[keyof typeof MODULES];

/**
 * Known screens within a module. `*` (wildcard) grants every screen and is the
 * convention used by the system role matrix to avoid enumerating each screen.
 */
export const SCREENS = {
  LIST: 'list',
  DETAIL: 'detail',
  CREATE: 'create',
  EDIT: 'edit',
} as const;

/** Union of known screen identifiers. */
export type ScreenName = (typeof SCREENS)[keyof typeof SCREENS];

/** Supported permission actions. */
export const ACTIONS = {
  READ: 'read',
  WRITE: 'write',
  DELETE: 'delete',
} as const;

/** Union of known action identifiers. */
export type ActionName = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Canonical names of the three seeded system roles. */
export const SYSTEM_ROLE_NAMES = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  USER: 'User',
} as const;

/** Union of system role names. */
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[keyof typeof SYSTEM_ROLE_NAMES];

/** A seeded system role and the permissions granted to it. */
export interface SystemRoleDefinition {
  name: SystemRoleName;
  description: string;
  permissions: readonly PermissionDescriptor[];
}

/** Modules a Manager may read and write (everything except administration). */
const MANAGER_MODULES: readonly ModuleName[] = [
  MODULES.SALES,
  MODULES.PRODUCTS,
  MODULES.STOCK,
  MODULES.CUSTOMERS,
  MODULES.SUPPLIERS,
  MODULES.PURCHASES,
  MODULES.CASH,
  MODULES.REPORTS,
  MODULES.SETTINGS,
];

/** Modules a standard User may read (operational, non-administrative). */
const USER_READABLE_MODULES: readonly ModuleName[] = [
  MODULES.SALES,
  MODULES.PRODUCTS,
  MODULES.STOCK,
  MODULES.CUSTOMERS,
  MODULES.SUPPLIERS,
  MODULES.PURCHASES,
  MODULES.CASH,
  MODULES.REPORTS,
];

/**
 * Manager permissions: read + write across all business modules (every
 * screen, via the screen wildcard) but NO `delete` action and NO access to the
 * `administration` module. This keeps managers productive while reserving
 * destructive and platform-administration capabilities for Admins.
 */
const MANAGER_PERMISSIONS: readonly PermissionDescriptor[] = MANAGER_MODULES.flatMap((module) => [
  { module, screen: PERMISSION_WILDCARD, action: ACTIONS.READ },
  { module, screen: PERMISSION_WILDCARD, action: ACTIONS.WRITE },
]);

/**
 * User permissions: read-only across operational modules. Users can view data
 * but cannot create, edit, delete, or touch settings/administration.
 */
const USER_PERMISSIONS: readonly PermissionDescriptor[] = USER_READABLE_MODULES.map((module) => ({
  module,
  screen: PERMISSION_WILDCARD,
  action: ACTIONS.READ,
}));

/**
 * Default permission matrix seeded for every new tenant (Requirement 28.5 —
 * "seed initial data: roles, permissions, default configurations").
 *
 * | Role    | Scope                                                            |
 * | ------- | ---------------------------------------------------------------- |
 * | Admin   | Full access — single wildcard grant (module/screen/action = `*`) |
 * | Manager | read + write on all modules except `administration`; no `delete` |
 * | User    | read-only on operational modules                                 |
 */
export const SYSTEM_ROLE_DEFINITIONS: readonly SystemRoleDefinition[] = [
  {
    name: SYSTEM_ROLE_NAMES.ADMIN,
    description: 'Full access to every module, screen and action',
    permissions: [
      { module: PERMISSION_WILDCARD, screen: PERMISSION_WILDCARD, action: PERMISSION_WILDCARD },
    ],
  },
  {
    name: SYSTEM_ROLE_NAMES.MANAGER,
    description: 'Read and write across all business modules; no destructive or administrative actions',
    permissions: MANAGER_PERMISSIONS,
  },
  {
    name: SYSTEM_ROLE_NAMES.USER,
    description: 'Read-only access to operational modules',
    permissions: USER_PERMISSIONS,
  },
];
