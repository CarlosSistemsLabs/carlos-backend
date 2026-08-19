import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateRoleUseCase } from './create-role.use-case.js';
import { Role } from '../../domain/entities/role.js';
import type { IRoleRepository } from '../../domain/repositories/role-repository.js';
import { ConflictError, ValidationError } from '@domain/errors/index.js';

function makeRoles(): IRoleRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByTenant: vi.fn().mockResolvedValue([]),
    findByName: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (role: Role) => role),
    update: vi.fn(async (role: Role) => role),
    addPermissions: vi.fn(async (role: Role) => role),
    replacePermissions: vi.fn(async (role: Role) => role),
  };
}

const input = {
  tenantId: 'tenant-1',
  name: 'Cashier',
  description: 'Handles the cash register',
  permissions: [{ module: 'cash', screen: 'list', action: 'read' }],
};

describe('CreateRoleUseCase', () => {
  let roles: IRoleRepository;
  let useCase: CreateRoleUseCase;

  beforeEach(() => {
    roles = makeRoles();
    useCase = new CreateRoleUseCase(roles);
  });

  it('persists a new role with its permissions', async () => {
    const result = await useCase.execute(input);
    expect(roles.findByName).toHaveBeenCalledWith('tenant-1', 'Cashier');
    expect(roles.create).toHaveBeenCalledOnce();
    expect(result.name).toBe('Cashier');
    expect(result.isSystem).toBe(false);
    expect(result.permissions).toEqual([{ module: 'cash', screen: 'list', action: 'read' }]);
  });

  it('throws ConflictError when a role with the same name exists in the tenant', async () => {
    vi.mocked(roles.findByName).mockResolvedValue(
      Role.create({ tenantId: 'tenant-1', name: 'Cashier' }),
    );
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(roles.create).not.toHaveBeenCalled();
  });

  it('rejects an empty role name before touching the repository', async () => {
    await expect(useCase.execute({ ...input, name: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(roles.findByName).not.toHaveBeenCalled();
  });

  it('rejects an invalid permission', async () => {
    await expect(
      useCase.execute({ ...input, permissions: [{ module: '', screen: 'list', action: 'read' }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(roles.create).not.toHaveBeenCalled();
  });
});
