import { describe, it, expect, vi } from 'vitest';
import {
  AuthUser,
  ACCOUNT_LOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './auth-user.js';
import type { IPasswordHasher } from '../ports/password-hasher.js';

function makeUser(): AuthUser {
  return AuthUser.create({
    tenantId: 'tenant-1',
    email: 'user@example.com',
    passwordHash: 'hashed',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId: 'role-1',
  });
}

describe('AuthUser', () => {
  it('creates an active user with no login history', () => {
    const user = makeUser();
    expect(user.isActive).toBe(true);
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
    expect(user.lastLoginAt).toBeNull();
    expect(user.phone).toBeNull();
  });

  it('delegates password validation to the hasher port', async () => {
    const hasher: IPasswordHasher = {
      hash: vi.fn(),
      compare: vi.fn().mockResolvedValue(true),
    };
    const user = makeUser();

    await expect(user.validatePassword('plain', hasher)).resolves.toBe(true);
    expect(hasher.compare).toHaveBeenCalledWith('plain', 'hashed');
  });

  it('locks until a future instant and reports isLocked', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const user = makeUser();
    user.lock(undefined, now);

    expect(user.lockedUntil?.getTime()).toBe(now.getTime() + ACCOUNT_LOCK_DURATION_MS);
    expect(user.isLocked(now)).toBe(true);
    expect(user.isLocked(new Date(now.getTime() + ACCOUNT_LOCK_DURATION_MS + 1))).toBe(false);
  });

  it('is not locked when lockedUntil is null', () => {
    expect(makeUser().isLocked()).toBe(false);
  });

  it('unlock clears the lock and resets the failed counter', () => {
    const user = makeUser();
    user.lock();
    user.registerFailedLogin();
    user.unlock();

    expect(user.lockedUntil).toBeNull();
    expect(user.failedLoginCount).toBe(0);
  });

  it('increments the failed-login counter', () => {
    const user = makeUser();
    expect(user.registerFailedLogin()).toBe(1);
    expect(user.registerFailedLogin()).toBe(2);
    expect(user.failedLoginCount).toBe(2);
  });

  it('locks the account once the failure threshold is reached', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const user = makeUser();
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i += 1) {
      user.registerFailedLogin(now);
      expect(user.isLocked(now)).toBe(false);
    }
    user.registerFailedLogin(now);
    expect(user.isLocked(now)).toBe(true);
  });

  it('recordLogin stamps lastLoginAt and clears lock + counter', () => {
    const now = new Date('2025-06-01T12:00:00Z');
    const user = makeUser();
    user.registerFailedLogin();
    user.lock();

    user.recordLogin(now);

    expect(user.lastLoginAt).toEqual(now);
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('reconstitutes from persisted state preserving identity', () => {
    const user = AuthUser.reconstitute('user-9', {
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
      failedLoginCount: 3,
      lockedUntil: null,
    });

    expect(user.id).toBe('user-9');
    expect(user.failedLoginCount).toBe(3);
  });
});
