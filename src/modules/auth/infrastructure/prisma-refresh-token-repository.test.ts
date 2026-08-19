import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaRefreshTokenRepository,
  type RefreshTokenPrismaClient,
  type RefreshTokenRow,
} from './prisma-refresh-token-repository.js';

function makeRow(overrides: Partial<RefreshTokenRow> = {}): RefreshTokenRow {
  return {
    id: 'rt-1',
    userId: 'user-1',
    token: 'opaque-token',
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    isRevoked: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PrismaRefreshTokenRepository', () => {
  let prisma: RefreshTokenPrismaClient;
  let repo: PrismaRefreshTokenRepository;

  beforeEach(() => {
    prisma = {
      refreshToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    repo = new PrismaRefreshTokenRepository(prisma);
  });

  it('create persists the token and returns the stored record', async () => {
    vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeRow());

    const record = await repo.create({
      userId: 'user-1',
      token: 'opaque-token',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });

    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        token: 'opaque-token',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    expect(record).toEqual({
      id: 'rt-1',
      userId: 'user-1',
      token: 'opaque-token',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      isRevoked: false,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
  });

  it('findByToken looks up by the opaque value', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(makeRow());

    const record = await repo.findByToken('opaque-token');

    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { token: 'opaque-token' },
    });
    expect(record?.token).toBe('opaque-token');
  });

  it('findByToken returns null when unknown', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);
    expect(await repo.findByToken('missing')).toBeNull();
  });

  it('revoke marks a single token as revoked (rotation/logout)', async () => {
    vi.mocked(prisma.refreshToken.update).mockResolvedValue(makeRow({ isRevoked: true }));

    await repo.revoke('opaque-token');

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { token: 'opaque-token' },
      data: { isRevoked: true },
    });
  });

  it('revokeAllForUser revokes every active token for the user (global sign-out)', async () => {
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 3 });

    await repo.revokeAllForUser('user-1');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isRevoked: false },
      data: { isRevoked: true },
    });
  });
});
