import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaUserRepository,
  type UserPrismaClient,
  type UserRow,
} from './prisma-user-repository.js';
import { AuthUser } from '../domain/entities/auth-user.js';

function makeRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'user@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: null,
    avatar: null,
    roleId: 'role-1',
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    ...overrides,
  };
}

describe('PrismaUserRepository', () => {
  let prisma: UserPrismaClient;
  let repo: PrismaUserRepository;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    repo = new PrismaUserRepository(prisma);
  });

  it('findByEmail scopes by tenant + email and excludes soft-deleted rows', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(makeRow());

    const user = await repo.findByEmail('tenant-1', 'user@example.com');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', email: 'user@example.com', deletedAt: null },
    });
    expect(user).toBeInstanceOf(AuthUser);
    expect(user?.id).toBe('user-1');
    expect(user?.tenantId).toBe('tenant-1');
  });

  it('findByEmail returns null when no row matches', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    expect(await repo.findByEmail('tenant-1', 'nope@example.com')).toBeNull();
  });

  it('findById scopes by id and excludes soft-deleted rows', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(makeRow({ id: 'user-9' }));

    const user = await repo.findById('user-9');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-9', deletedAt: null },
    });
    expect(user?.id).toBe('user-9');
  });

  it('create persists the aggregate id and all attributes, returning the stored user', async () => {
    const entity = AuthUser.create(
      {
        tenantId: 'tenant-1',
        email: 'new@example.com',
        passwordHash: 'hash',
        firstName: 'Grace',
        lastName: 'Hopper',
        roleId: 'role-1',
      },
      'user-new',
    );
    vi.mocked(prisma.user.create).mockResolvedValue(
      makeRow({ id: 'user-new', email: 'new@example.com', firstName: 'Grace', lastName: 'Hopper' }),
    );

    const saved = await repo.create(entity);

    const createArg = vi.mocked(prisma.user.create).mock.calls[0]?.[0];
    expect(createArg?.data).toMatchObject({
      id: 'user-new',
      tenantId: 'tenant-1',
      email: 'new@example.com',
      passwordHash: 'hash',
      firstName: 'Grace',
      lastName: 'Hopper',
      roleId: 'role-1',
      isActive: true,
      failedLoginCount: 0,
    });
    expect(saved.email).toBe('new@example.com');
  });

  it('update writes mutable fields keyed by id and maps the result back', async () => {
    const entity = AuthUser.reconstitute('user-1', {
      tenantId: 'tenant-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roleId: 'role-1',
      phone: null,
      avatar: null,
      isActive: true,
      lastLoginAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    entity.recordLogin(new Date('2024-01-01T00:00:00Z'));
    vi.mocked(prisma.user.update).mockResolvedValue(
      makeRow({ lastLoginAt: new Date('2024-01-01T00:00:00Z') }),
    );

    const updated = await repo.update(entity);

    const updateArg = vi.mocked(prisma.user.update).mock.calls[0]?.[0];
    expect(updateArg?.where).toEqual({ id: 'user-1' });
    expect(updateArg?.data).toMatchObject({ failedLoginCount: 0, isActive: true });
    expect(updated.lastLoginAt).toEqual(new Date('2024-01-01T00:00:00Z'));
  });
});
