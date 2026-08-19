import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StructuredAuthEventLogger,
  type StructuredLogger,
} from './structured-auth-event-logger.js';
import type { AuthEventContext } from '../application/ports/auth-event-logger.js';

const TIMESTAMP = new Date('2024-01-02T03:04:05.000Z');

function makeContext(overrides: Partial<AuthEventContext> = {}): AuthEventContext {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    email: 'user@example.com',
    ipAddress: '203.0.113.7',
    userAgent: 'vitest',
    requestId: 'req-1',
    timestamp: TIMESTAMP,
    ...overrides,
  };
}

describe('StructuredAuthEventLogger', () => {
  let logger: StructuredLogger;
  let sink: StructuredAuthEventLogger;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn() };
    sink = new StructuredAuthEventLogger(logger);
  });

  it('logs a successful login at info with the full structured field set', () => {
    sink.loginSucceeded(makeContext());

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'auth.login.succeeded',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        email: 'user@example.com',
        ip_address: '203.0.113.7',
        user_agent: 'vitest',
        request_id: 'req-1',
        timestamp: TIMESTAMP.toISOString(),
      },
      'authentication attempt',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a failed login at warn including the reason', () => {
    sink.loginFailed(makeContext({ userId: null }), 'invalid_credentials');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.login.failed',
        reason: 'invalid_credentials',
        user_id: null,
      }),
      'authentication attempt',
    );
  });

  it('logs an account lock at warn', () => {
    sink.accountLocked(makeContext());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.account.locked' }),
      'authentication attempt',
    );
  });

  it('logs a token refresh at info', () => {
    sink.tokenRefreshed(makeContext());

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.token.refreshed' }),
      'authentication attempt',
    );
  });

  it('logs a logout at info and normalizes missing fields to null', () => {
    sink.logout({ tenantId: null, timestamp: TIMESTAMP });

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'auth.logout',
        tenant_id: null,
        user_id: null,
        email: null,
        ip_address: null,
        user_agent: null,
        request_id: null,
        timestamp: TIMESTAMP.toISOString(),
      },
      'authentication attempt',
    );
  });
});
