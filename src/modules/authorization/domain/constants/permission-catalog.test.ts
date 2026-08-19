import { describe, it, expect } from 'vitest';
import {
  SYSTEM_ROLE_DEFINITIONS,
  SYSTEM_ROLE_NAMES,
  MODULES,
  ACTIONS,
  type SystemRoleName,
} from './permission-catalog.js';
import { Role } from '../entities/role.js';
import { Permission } from '../value-objects/permission.js';

/** Builds a Role from its seeded definition for permission assertions. */
function roleFor(name: SystemRoleName): Role {
  const definition = SYSTEM_ROLE_DEFINITIONS.find((d) => d.name === name);
  if (definition === undefined) {
    throw new Error(`missing system role definition: ${name}`);
  }
  return Role.create({
    tenantId: 'tenant-1',
    name: definition.name,
    description: definition.description,
    isSystem: true,
    permissions: definition.permissions.map((p) => Permission.fromDescriptor(p)),
  });
}

describe('system role permission matrix', () => {
  it('defines exactly the three system roles', () => {
    expect(SYSTEM_ROLE_DEFINITIONS.map((d) => d.name)).toEqual([
      SYSTEM_ROLE_NAMES.ADMIN,
      SYSTEM_ROLE_NAMES.MANAGER,
      SYSTEM_ROLE_NAMES.USER,
    ]);
  });

  describe('Admin', () => {
    const admin = roleFor(SYSTEM_ROLE_NAMES.ADMIN);

    it('grants every module/screen/action via a single wildcard', () => {
      expect(admin.permissions).toHaveLength(1);
      for (const module of Object.values(MODULES)) {
        for (const action of Object.values(ACTIONS)) {
          expect(admin.hasPermission(module, 'list', action)).toBe(true);
        }
      }
      expect(admin.hasPermission('administration', 'detail', 'delete')).toBe(true);
    });
  });

  describe('Manager', () => {
    const manager = roleFor(SYSTEM_ROLE_NAMES.MANAGER);

    it('can read and write business modules', () => {
      expect(manager.hasPermission(MODULES.SALES, 'list', ACTIONS.READ)).toBe(true);
      expect(manager.hasPermission(MODULES.PRODUCTS, 'create', ACTIONS.WRITE)).toBe(true);
      expect(manager.hasPermission(MODULES.SETTINGS, 'edit', ACTIONS.WRITE)).toBe(true);
    });

    it('cannot perform destructive (delete) actions', () => {
      expect(manager.hasPermission(MODULES.SALES, 'detail', ACTIONS.DELETE)).toBe(false);
      expect(manager.hasPermission(MODULES.PRODUCTS, 'list', ACTIONS.DELETE)).toBe(false);
    });

    it('has no access to the administration module', () => {
      expect(manager.hasPermission(MODULES.ADMINISTRATION, 'list', ACTIONS.READ)).toBe(false);
      expect(manager.hasPermission(MODULES.ADMINISTRATION, 'list', ACTIONS.WRITE)).toBe(false);
    });
  });

  describe('User', () => {
    const user = roleFor(SYSTEM_ROLE_NAMES.USER);

    it('can read operational modules', () => {
      expect(user.hasPermission(MODULES.SALES, 'list', ACTIONS.READ)).toBe(true);
      expect(user.hasPermission(MODULES.REPORTS, 'detail', ACTIONS.READ)).toBe(true);
    });

    it('cannot write or delete anything', () => {
      expect(user.hasPermission(MODULES.SALES, 'create', ACTIONS.WRITE)).toBe(false);
      expect(user.hasPermission(MODULES.PRODUCTS, 'detail', ACTIONS.DELETE)).toBe(false);
    });

    it('cannot touch settings or administration', () => {
      expect(user.hasPermission(MODULES.SETTINGS, 'list', ACTIONS.READ)).toBe(false);
      expect(user.hasPermission(MODULES.ADMINISTRATION, 'list', ACTIONS.READ)).toBe(false);
    });
  });
});
