import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogoutUseCase } from './logout.use-case.js';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token-repository.js';
import type { IAuthEventLogger } from '../ports/auth-event-logger.js';

describe('LogoutUseCase', () => {
  let refreshTokens: IRefreshTokenRepository;
  let authEvents: IAuthEventLogger;
  let useCase: LogoutUseCase;

  beforeEach(() => {
    refreshTokens = {
      create: vi.fn(),
      findByToken: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined),
      revokeAllForUser: vi.fn(),
    };
    authEvents = {
      loginSucceeded: vi.fn(),
      loginFailed: vi.fn(),
      accountLocked: vi.fn(),
      tokenRefreshed: vi.fn(),
      logout: vi.fn(),
    };
    useCase = new LogoutUseCase(refreshTokens, authEvents);
  });

  it('revokes the supplied refresh token', async () => {
    await useCase.execute({ refreshToken: 'some-token' });
    expect(refreshTokens.revoke).toHaveBeenCalledWith('some-token');
    expect(authEvents.logout).toHaveBeenCalledOnce();
  });

  it('is idempotent — resolves even when revoke is a no-op', async () => {
    await expect(useCase.execute({ refreshToken: 'unknown' })).resolves.toBeUndefined();
  });
});
