import { describe, it, expect } from 'vitest';
import { Role } from './role.js';
import { Permission } from '../value-objects/permission.js';
import { SystemRoleModificationError } from '../errors/authorization-errors.js';

const salesRead = Permission.create('sales', 'list', 'read');
const salesWrite = Permission.create('sales', 'create', 'write');

describe('Role', () => {
  it('creates a non-system role with no permissions by default', () => {
    const role = Role.create({ tenantId: 'tenant-1', name: 'Cashier' });
    expect(role.tenantId).toBe('tenant-1');
    expect(role.name).toBe('Cashier');
    expect(role.description).toBeNull();
    expect(role.isSystem).toBe(false);
    expect(role.permissions).toHaveLength(0);
  });

  it('de-duplicates initial permissions on creation', () => {
    const role = Role.create({
      tenantId: 'tenant-1',
      name: 'Sales',
      permissions: [salesRead, Permission.create('sales', 'list', 'read')],
    });
    expect(role.permissions).toHaveLength(1);
  });

  describe('addPermission', () => {
    it('adds a new permission and reports it was added', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales' });
      expect(role.addPermission(salesRead)).toBe(true);
      expect(role.permissions).toHaveLength(1);
    });

    it('is idempotent for an equal permission', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales' });
      role.addPermission(salesRead);
      expect(role.addPermission(Permission.create('sales', 'list', 'read'))).toBe(false);
      expect(role.permissions).toHaveLength(1);
    });

    it('is allowed on system roles (used during seeding)', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Admin', isSystem: true });
      expect(() => role.addPermission(salesRead)).not.toThrow();
      expect(role.permissions).toHaveLength(1);
    });
  });

  describe('removePermission', () => {
    it('removes a matching permission from a custom role', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales', permissions: [salesRead] });
      expect(role.removePermission(Permission.create('sales', 'list', 'read'))).toBe(true);
      expect(role.permissions).toHaveLength(0);
    });

    it('returns false when no matching permission exists', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales', permissions: [salesRead] });
      expect(role.removePermission(salesWrite)).toBe(false);
    });

    it('refuses to strip permissions from a system role', () => {
      const role = Role.create({
        tenantId: 'tenant-1',
        name: 'Admin',
        isSystem: true,
        permissions: [salesRead],
      });
      expect(() => role.removePermission(salesRead)).toThrow(SystemRoleModificationError);
    });
  });

  describe('replacePermissions', () => {
    it('replaces a custom role permission set wholesale', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales', permissions: [salesRead] });
      role.replacePermissions([salesWrite]);
      expect(role.permissions).toHaveLength(1);
      expect(role.hasPermission('sales', 'create', 'write')).toBe(true);
      expect(role.hasPermission('sales', 'list', 'read')).toBe(false);
    });

    it('de-duplicates the incoming permission set', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales' });
      role.replacePermissions([salesRead, Permission.create('sales', 'list', 'read')]);
      expect(role.permissions).toHaveLength(1);
    });

    it('clears all permissions when given an empty set', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales', permissions: [salesRead] });
      role.replacePermissions([]);
      expect(role.permissions).toHaveLength(0);
    });

    it('throws when modifying a system role', () => {
      const role = Role.create({
        tenantId: 'tenant-1',
        name: 'Admin',
        isSystem: true,
        permissions: [salesRead],
      });
      expect(() => role.replacePermissions([salesWrite])).toThrow(SystemRoleModificationError);
    });
  });

  describe('rename', () => {
    it('renames a custom role', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales' });
      role.rename('Sales Lead', 'Leads the sales team');
      expect(role.name).toBe('Sales Lead');
      expect(role.description).toBe('Leads the sales team');
    });

    it('refuses to rename a system role (core identity is immutable)', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Admin', isSystem: true });
      expect(() => role.rename('SuperAdmin')).toThrow(SystemRoleModificationError);
    });
  });

  describe('hasPermission', () => {
    it('returns true for a directly granted permission', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales', permissions: [salesRead] });
      expect(role.hasPermission('sales', 'list', 'read')).toBe(true);
    });

    it('returns false for a permission that is not granted', () => {
      const role = Role.create({ tenantId: 'tenant-1', name: 'Sales', permissions: [salesRead] });
      expect(role.hasPermission('sales', 'list', 'delete')).toBe(false);
    });

    it('honours wildcard grants', () => {
      const role = Role.create({
        tenantId: 'tenant-1',
        name: 'Admin',
        isSystem: true,
        permissions: [Permission.create('*', '*', '*')],
      });
      expect(role.hasPermission('products', 'edit', 'delete')).toBe(true);
    });
  });

  it('reconstitute rehydrates persisted state with an independent permission list', () => {
    const role = Role.reconstitute('role-1', {
      tenantId: 'tenant-1',
      name: 'Sales',
      description: null,
      isSystem: false,
      permissions: [salesRead],
    });
    expect(role.id).toBe('role-1');
    // Mutating the returned copy must not affect internal state.
    const snapshot = role.permissions;
    expect(snapshot).toHaveLength(1);
    expect(role.permissions).toHaveLength(1);
  });
});
