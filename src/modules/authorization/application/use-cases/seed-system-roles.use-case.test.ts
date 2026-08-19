import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeedSystemRolesUseCase } from './seed-system-roles.use-case.js';
import type { Role } from '../../domain/entities/role.js';
import type { IRoleRepository } from '../../domain/repositories/role-repository.js';
import { SYSTEM_ROLE_NAMES } from '../../domain/constants/permission-catalog.js';

/** In-memory role store keyed by `${tenantId}:${name}`. */
function makeRoles(): { repo: IRoleRepository; store: Map<string, Role> } {
  const store = new Map<string, Role>();
  const repo: IRoleRepository = {
    findById: vi.fn().mockResolvedValue(null),
    findByTenant: vi.fn().mockResolvedValue([]),
    findByName: vi.fn(async (tenantId: string, name: string) => store.get(`${tenantId}:${name}`) ?? null),
    create: vi.fn(async (role: Role) => {
      store.set(`${role.tenantId}:${role.name}`, role);
      return role;
    }),
    update: vi.fn(async (role: Role) => role),
    addPermissions: vi.fn(async (role: Role) => role),
    replacePermissions: vi.fn(async (role: Role) => role),
  };
  return { repo, store };
}

describe('SeedSystemRolesUseCase', () => {
  let repo: IRoleRepository;
  let useCase: SeedSystemRolesUseCase;

  beforeEach(() => {
    ({ repo } = makeRoles());
    useCase = new SeedSystemRolesUseCase(repo);
  });

  it('creates the three system roles for a tenant', async () => {
    const result = await useCase.execute({ tenantId: 'tenant-1' });
    expect(result.map((r) => r.name)).toEqual([
      SYSTEM_ROLE_NAMES.ADMIN,
      SYSTEM_ROLE_NAMES.MANAGER,
      SYSTEM_ROLE_NAMES.USER,
    ]);
    expect(result.every((r) => r.isSystem)).toBe(true);
    expect(repo.create).toHaveBeenCalledTimes(3);
  });

  it('seeds the documented permission matrix (Admin = full wildcard)', async () => {
    const [admin] = await useCase.execute({ tenantId: 'tenant-1' });
    expect(admin?.permissions).toEqual([{ module: '*', screen: '*', action: '*' }]);
  });

  it('is idempotent: re-running does not recreate existing roles', async () => {
    await useCase.execute({ tenantId: 'tenant-1' });
    vi.mocked(repo.create).mockClear();

    const result = await useCase.execute({ tenantId: 'tenant-1' });
    expect(repo.create).not.toHaveBeenCalled();
    expect(result).toHaveLength(3);
  });
});
