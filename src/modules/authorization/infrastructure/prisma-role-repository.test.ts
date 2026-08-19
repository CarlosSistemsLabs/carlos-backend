import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaRoleRepository,
  type RolePrismaClient,
  type RoleRow,
} from './prisma-role-repository.js';
import { Role } from '../domain/entities/role.js';
import { Permission } from '../domain/value-objects/permission.js';

function roleRow(overrides: Partial<RoleRow> = {}): RoleRow {
  return {
    id: 'role-1',
    tenantId: 'tenant-1',
    name: 'Sales',
    description: null,
    isSystem: false,
    permissions: [{ id: 'p1', roleId: 'role-1', module: 'sales', screen: 'list', action: 'read' }],
    ...overrides,
  };
}

function makeClient(): RolePrismaClient {
  return {
    role: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(async () => roleRow()),
      update: vi.fn(async () => roleRow()),
    },
    permission: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('PrismaRoleRepository', () => {
  let client: RolePrismaClient;
  let repo: PrismaRoleRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaRoleRepository(client);
  });

  it('maps a persistence row (with permissions) to the domain aggregate', async () => {
    vi.mocked(client.role.findFirst).mockResolvedValue(roleRow());
    const role = await repo.findById('role-1');
    expect(role).not.toBeNull();
    expect(role?.name).toBe('Sales');
    expect(role?.hasPermission('sales', 'list', 'read')).toBe(true);
  });

  it('returns null when no role is found', async () => {
    expect(await repo.findById('missing')).toBeNull();
  });

  it('scopes findByName by tenant and name', async () => {
    await repo.findByName('tenant-1', 'Sales');
    expect(client.role.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', name: 'Sales' },
      include: { permissions: true },
    });
  });

  it('persists a role with its permissions via nested create', async () => {
    const role = Role.create({
      tenantId: 'tenant-1',
      name: 'Sales',
      permissions: [Permission.create('sales', 'list', 'read')],
    });
    await repo.create(role);

    const args = vi.mocked(client.role.create).mock.calls[0]![0];
    expect(args.data).toMatchObject({ tenantId: 'tenant-1', name: 'Sales', isSystem: false });
    expect(args.data.permissions).toEqual({
      create: [{ module: 'sales', screen: 'list', action: 'read' }],
    });
  });

  it('attaches permissions idempotently with skipDuplicates and re-reads the role', async () => {
    vi.mocked(client.role.findFirst).mockResolvedValue(roleRow());
    const role = Role.reconstitute('role-1', {
      tenantId: 'tenant-1',
      name: 'Sales',
      description: null,
      isSystem: false,
      permissions: [],
    });

    await repo.addPermissions(role, [Permission.create('sales', 'list', 'read')]);

    expect(client.permission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'role-1', module: 'sales', screen: 'list', action: 'read' }],
      skipDuplicates: true,
    });
    expect(client.role.findFirst).toHaveBeenCalled();
  });

  it('skips the createMany call when there are no permissions to add', async () => {
    vi.mocked(client.role.findFirst).mockResolvedValue(roleRow());
    const role = Role.reconstitute('role-1', {
      tenantId: 'tenant-1',
      name: 'Sales',
      description: null,
      isSystem: false,
      permissions: [],
    });

    await repo.addPermissions(role, []);
    expect(client.permission.createMany).not.toHaveBeenCalled();
  });

  it('replaces permissions by clearing existing rows then inserting the new set', async () => {
    vi.mocked(client.role.findFirst).mockResolvedValue(roleRow());
    const role = Role.reconstitute('role-1', {
      tenantId: 'tenant-1',
      name: 'Sales',
      description: null,
      isSystem: false,
      permissions: [],
    });

    await repo.replacePermissions(role, [Permission.create('cash', 'list', 'read')]);

    expect(client.permission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-1' } });
    expect(client.permission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'role-1', module: 'cash', screen: 'list', action: 'read' }],
      skipDuplicates: true,
    });
  });

  it('clears permissions without inserting when the replacement set is empty', async () => {
    vi.mocked(client.role.findFirst).mockResolvedValue(roleRow());
    const role = Role.reconstitute('role-1', {
      tenantId: 'tenant-1',
      name: 'Sales',
      description: null,
      isSystem: false,
      permissions: [],
    });

    await repo.replacePermissions(role, []);

    expect(client.permission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-1' } });
    expect(client.permission.createMany).not.toHaveBeenCalled();
  });
});
