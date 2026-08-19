import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginUserUseCase } from './login-user.use-case.js';
import { AuthUser, MAX_FAILED_LOGIN_ATTEMPTS } from '../../domain/entities/auth-user.js';
import type { IUserRepository } from '../../domain/repositories/user-repository.js';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token-repository.js';
import type { IPasswordHasher } from '../../domain/ports/password-hasher.js';
import type { ITokenService } from '../ports/token-service.js';
import type { IAuthEventLogger } from '../ports/auth-event-logger.js';
import {
  AccountInactiveError,
  AccountLockedError,
  InvalidCredentialsError,
} from '../../domain/errors/auth-errors.js';

function makeUser(overrides: Partial<Parameters<typeof AuthUser.create>[0]> = {}): AuthUser {
  return AuthUser.create({
    tenantId: 'tenant-1',
    email: 'user@example.com',
    passwordHash: 'stored-hash',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId: 'role-1',
    ...overrides,
  });
}

const TTL = 7 * 24 * 60 * 60 * 1000;

describe('LoginUserUseCase', () => {
  let users: IUserRepository;
  let refreshTokens: IRefreshTokenRepository;
  let hasher: IPasswordHasher;
  let tokens: ITokenService;
  let authEvents: IAuthEventLogger;
  let useCase: LoginUserUseCase;

  beforeEach(() => {
    users = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(async (u: AuthUser) => u),
      update: vi.fn(async (u: AuthUser) => u),
    };
    refreshTokens = {
      create: vi.fn(async (i) => ({
        id: 'rt-1',
        userId: i.userId,
        token: i.token,
        expiresAt: i.expiresAt,
        isRevoked: false,
        createdAt: new Date(),
      })),
      findByToken: vi.fn(),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn(),
    };
    hasher = { hash: vi.fn(), compare: vi.fn() };
    tokens = {
      issueAccessToken: vi.fn().mockResolvedValue('access-token'),
      generateRefreshToken: vi.fn().mockResolvedValue('refresh-token'),
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
    useCase = new LoginUserUseCase(users, refreshTokens, hasher, tokens, authEvents);
  });

  const input = { tenantId: 'tenant-1', email: 'user@example.com', password: 'Str0ngPass' };

  it('issues tokens and records login on valid credentials', async () => {
    const user = makeUser();
    vi.mocked(users.findByEmail).mockResolvedValue(user);
    vi.mocked(hasher.compare).mockResolvedValue(true);

    const result = await useCase.execute(input);

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.user.email).toBe('user@example.com');
    expect(user.lastLoginAt).not.toBeNull();
    expect(refreshTokens.create).toHaveBeenCalledOnce();
    expect(users.update).toHaveBeenCalledWith(user);
    expect(authEvents.loginSucceeded).toHaveBeenCalledOnce();
    expect(authEvents.loginFailed).not.toHaveBeenCalled();
  });

  it('throws InvalidCredentialsError when the user does not exist', async () => {
    vi.mocked(users.findByEmail).mockResolvedValue(null);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(authEvents.loginFailed).toHaveBeenCalledWith(
      expect.objectContaining({ email: input.email }),
      'user_not_found',
    );
  });

  it('throws InvalidCredentialsError on wrong password and records a failed attempt', async () => {
    const user = makeUser();
    vi.mocked(users.findByEmail).mockResolvedValue(user);
    vi.mocked(hasher.compare).mockResolvedValue(false);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(user.failedLoginCount).toBe(1);
    expect(users.update).toHaveBeenCalledWith(user);
    expect(tokens.issueAccessToken).not.toHaveBeenCalled();
    expect(authEvents.loginFailed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
      'invalid_credentials',
    );
    expect(authEvents.accountLocked).not.toHaveBeenCalled();
  });

  it('throws AccountLockedError when the threshold is reached on this attempt', async () => {
    const user = makeUser();
    // Pre-load failures up to one below the threshold.
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i += 1) {
      user.registerFailedLogin();
    }
    user.unlock(); // reset lock but keep counter logic; re-add failures below threshold
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i += 1) {
      user.registerFailedLogin();
    }
    vi.mocked(users.findByEmail).mockResolvedValue(user);
    vi.mocked(hasher.compare).mockResolvedValue(false);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountLockedError);
  });

  it('throws AccountLockedError when the account is already locked', async () => {
    const user = makeUser();
    user.lock();
    vi.mocked(users.findByEmail).mockResolvedValue(user);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountLockedError);
    expect(hasher.compare).not.toHaveBeenCalled();
  });

  it('throws AccountInactiveError when the account is deactivated', async () => {
    const user = makeUser();
    user.deactivate();
    vi.mocked(users.findByEmail).mockResolvedValue(user);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountInactiveError);
    expect(authEvents.loginFailed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
      'account_inactive',
    );
  });

  it('locks the account and logs the lock event on the 5th consecutive failure', async () => {
    const user = makeUser();
    vi.mocked(users.findByEmail).mockResolvedValue(user);
    vi.mocked(hasher.compare).mockResolvedValue(false);

    // First four failures: rejected as invalid credentials, no lock yet.
    for (let attempt = 1; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    expect(user.isLocked()).toBe(false);
    expect(authEvents.accountLocked).not.toHaveBeenCalled();

    // Fifth failure crosses the threshold: account locks and the event is logged.
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountLockedError);
    expect(user.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(user.isLocked()).toBe(true);
    expect(authEvents.accountLocked).toHaveBeenCalledOnce();
    expect(authEvents.loginSucceeded).not.toHaveBeenCalled();
  });

  it('records a failure with the account_locked reason when already locked', async () => {
    const user = makeUser();
    user.lock();
    vi.mocked(users.findByEmail).mockResolvedValue(user);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountLockedError);
    expect(authEvents.loginFailed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
      'account_locked',
    );
  });
});
