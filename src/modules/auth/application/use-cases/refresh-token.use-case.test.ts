import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RefreshTokenUseCase } from './refresh-token.use-case.js';
import { AuthUser } from '../../domain/entities/auth-user.js';
import type { IUserRepository } from '../../domain/repositories/user-repository.js';
import type {
  IRefreshTokenRepository,
  RefreshTokenRecord,
} from '../../domain/repositories/refresh-token-repository.js';
import type { ITokenService } from '../ports/token-service.js';
import type { IAuthEventLogger } from '../ports/auth-event-logger.js';
import { InvalidRefreshTokenError } from '../../domain/errors/auth-errors.js';

const TTL = 7 * 24 * 60 * 60 * 1000;

function makeUser(): AuthUser {
  return AuthUser.reconstitute('user-1', {
    tenantId: 'tenant-1',
    email: 'user@example.com',
    passwordHash: 'h',
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
}

function validRecord(): RefreshTokenRecord {
  return {
    id: 'rt-1',
    userId: 'user-1',
    token: 'old-token',
    expiresAt: new Date(Date.now() + TTL),
    isRevoked: false,
    createdAt: new Date(),
  };
}

describe('RefreshTokenUseCase', () => {
  let users: IUserRepository;
  let refreshTokens: IRefreshTokenRepository;
  let tokens: ITokenService;
  let authEvents: IAuthEventLogger;
  let useCase: RefreshTokenUseCase;

  beforeEach(() => {
    users = {
      findByEmail: vi.fn(),
      findById: vi.fn().mockResolvedValue(makeUser()),
      create: vi.fn(),
      update: vi.fn(),
    };
    refreshTokens = {
      create: vi.fn(async (i) => ({
        id: 'rt-2',
        userId: i.userId,
        token: i.token,
        expiresAt: i.expiresAt,
        isRevoked: false,
        createdAt: new Date(),
      })),
      findByToken: vi.fn().mockResolvedValue(validRecord()),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn(),
    };
    tokens = {
      issueAccessToken: vi.fn().mockResolvedValue('new-access'),
      generateRefreshToken: vi.fn().mockResolvedValue('new-refresh'),
      verifyAccessToken: vi.fn(),
      getRefreshTokenTtlMs: vi.fn().mockReturnValue(TTL),
    };
    authEvents = {
      loginSucceeded: vi.fn(),
      loginFailed: vi.fn(),
      accountLocked: vi.fn(),
      tokenRefreshed: vi.fn(),
      logout: vi.fn(),
    };
    useCase = new RefreshTokenUseCase(users, refreshTokens, tokens, authEvents);
  });

  it('rotates the token: revokes the old one and issues a new pair', async () => {
    const result = await useCase.execute({ refreshToken: 'old-token' });

    expect(refreshTokens.revoke).toHaveBeenCalledWith('old-token');
    expect(refreshTokens.create).toHaveBeenCalledOnce();
    expect(result).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(authEvents.tokenRefreshed).toHaveBeenCalledOnce();
  });

  it('throws when the token is unknown', async () => {
    vi.mocked(refreshTokens.findByToken).mockResolvedValue(null);
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('throws when the token is revoked', async () => {
    vi.mocked(refreshTokens.findByToken).mockResolvedValue({
      ...validRecord(),
      isRevoked: true,
    });
    await expect(useCase.execute({ refreshToken: 'old-token' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('throws when the token is expired', async () => {
    vi.mocked(refreshTokens.findByToken).mockResolvedValue({
      ...validRecord(),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(useCase.execute({ refreshToken: 'old-token' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(refreshTokens.revoke).not.toHaveBeenCalled();
  });

  it('throws when the owning user is missing or inactive', async () => {
    vi.mocked(users.findById).mockResolvedValue(null);
    await expect(useCase.execute({ refreshToken: 'old-token' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });
});
