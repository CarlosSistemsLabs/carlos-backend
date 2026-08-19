import { describe, it, expect } from 'vitest';
import { Permission, PERMISSION_WILDCARD } from './permission.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Permission', () => {
  it('creates a permission from module/screen/action and exposes them', () => {
    const permission = Permission.create('sales', 'list', 'read');
    expect(permission.module).toBe('sales');
    expect(permission.screen).toBe('list');
    expect(permission.action).toBe('read');
  });

  it('normalises segments (trims + lower-cases)', () => {
    const permission = Permission.create('  Sales ', 'LIST', 'Read');
    expect(permission.module).toBe('sales');
    expect(permission.screen).toBe('list');
    expect(permission.action).toBe('read');
  });

  it.each([
    ['', 'list', 'read'],
    ['sales', '  ', 'read'],
    ['sales', 'list', ''],
  ])('rejects empty segments (%s/%s/%s)', (module, screen, action) => {
    expect(() => Permission.create(module, screen, action)).toThrow(ValidationError);
  });

  it('uses value-based equality', () => {
    const a = Permission.create('sales', 'list', 'read');
    const b = Permission.create('SALES', 'list', 'read');
    const c = Permission.create('sales', 'list', 'write');
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('round-trips through its descriptor form', () => {
    const permission = Permission.create('products', 'edit', 'write');
    const descriptor = permission.toDescriptor();
    expect(descriptor).toEqual({ module: 'products', screen: 'edit', action: 'write' });
    expect(Permission.fromDescriptor(descriptor).equals(permission)).toBe(true);
  });

  describe('matches', () => {
    it('matches an identical triple', () => {
      const permission = Permission.create('sales', 'list', 'read');
      expect(permission.matches('sales', 'list', 'read')).toBe(true);
    });

    it('does not match a different triple', () => {
      const permission = Permission.create('sales', 'list', 'read');
      expect(permission.matches('sales', 'list', 'write')).toBe(false);
      expect(permission.matches('products', 'list', 'read')).toBe(false);
    });

    it('honours a wildcard on the action dimension', () => {
      const permission = Permission.create('sales', 'list', PERMISSION_WILDCARD);
      expect(permission.matches('sales', 'list', 'read')).toBe(true);
      expect(permission.matches('sales', 'list', 'delete')).toBe(true);
    });

    it('honours a full wildcard (Admin grant) for any request', () => {
      const permission = Permission.create(
        PERMISSION_WILDCARD,
        PERMISSION_WILDCARD,
        PERMISSION_WILDCARD,
      );
      expect(permission.isWildcard()).toBe(true);
      expect(permission.matches('anything', 'anywhere', 'anyhow')).toBe(true);
    });
  });

  it('serialises to a stable string form', () => {
    expect(Permission.create('cash', 'detail', 'read').toString()).toBe('cash:detail:read');
  });
});
