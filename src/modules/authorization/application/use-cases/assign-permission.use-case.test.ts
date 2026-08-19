import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssignPermissionUseCase } from './assign-permission.use-case.js';
import { Role } from '../../domain/entities/role.js';
import type { Permission } from '../../domain/value-objects/permission.js';
import type { IRoleRepository } from '../../domain/repositories/role-repository.js';
import { NotFoundError, ValidationError } from '@domain/errors/index.js';

/**
 * Fake repository backed by a single in-memory role whose `addPermissions`
 * faithfully reproduces the database's idempotent, skip-duplicates behaviour.
 */
function makeRoles(role: Role | null): IRoleRepository {
  return {
    findById: vi.fn(async (id: string) => (role !== null && role.id === id ? role : null)),
    findByTenant: vi.fn().mockResolvedValue([]),
    findByName: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (r: Role) => r),
    update: vi.fn(async (r: Role) => r),
    addPermissions: vi.fn(async (r: Role, permissions: readonly Permission[]) => {
      for (const permission of permissions) {
        r.addPermission(permission);
      }
      return r;
    }),
    replacePermissions: vi.fn(async (r: Role) => r),
  };
}

describe('AssignPermissionUseCase', () => {
  let role: Role;
  let roles: IRoleRepository;
  let useCase: AssignPermissionUseCase;

  beforeEach(() => {
    role = Role.create({ tenantId: 'tenant-1', name: 'Sales' }, 'role-1');
    roles = makeRoles(role);
    useCase = new AssignPermissionUseCase(roles);
  });

  it('attaches a new permission to the role', async () => {
    const result = await useCase.execute({
      roleId: 'role-1',
      permissions: [{ module: 'sales', screen: 'list', action: 'read' }],
    });
    expect(roles.addPermissions).toHaveBeenCalledOnce();
    expect(result.permissions).toEqual([{ module: 'sales', screen: 'list', action: 'read' }]);
  });

  it('is idempotent when assigning an already-held permission', async () => {
    const grant = { roleId: 'role-1', permissions: [{ module: 'sales', screen: 'list', action: 'read' }] };
    await useCase.execute(grant);
    const result = await useCase.execute(grant);
    expect(result.permissions).toHaveLength(1);
  });

  it('throws NotFoundError when the role does not exist', async () => {
    await expect(
      useCase.execute({
        roleId: 'missing',
        permissions: [{ module: 'sales', screen: 'list', action: 'read' }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an empty permission list', async () => {
    await expect(useCase.execute({ roleId: 'role-1', permissions: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(roles.findById).not.toHaveBeenCalled();
  });

  it('rejects an invalid permission', async () => {
    await expect(
      useCase.execute({
        roleId: 'role-1',
        permissions: [{ module: 'sales', screen: '', action: 'read' }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
