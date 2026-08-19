import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DetectingAuthEventLogger } from './detecting-auth-event-logger.js';
import type { IAuthEventLogger, AuthEventContext } from '../application/ports/auth-event-logger.js';
import type {
  ISuspiciousActivityDetector,
  SuspiciousActivitySignal,
} from '@common/alerting';

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

describe('DetectingAuthEventLogger', () => {
  let delegate: IAuthEventLogger & Record<string, ReturnType<typeof vi.fn>>;
  let detector: ISuspiciousActivityDetector & { record: ReturnType<typeof vi.fn> };
  let logger: DetectingAuthEventLogger;

  beforeEach(() => {
    delegate = {
      loginSucceeded: vi.fn(),
      loginFailed: vi.fn(),
      accountLocked: vi.fn(),
      tokenRefreshed: vi.fn(),
      logout: vi.fn(),
    };
    detector = { record: vi.fn() };
    logger = new DetectingAuthEventLogger(delegate, detector);
  });

  it('forwards every event to the delegate audit logger', () => {
    const ctx = makeContext();
    logger.loginSucceeded(ctx);
    logger.tokenRefreshed(ctx);
    logger.logout(ctx);

    expect(delegate.loginSucceeded).toHaveBeenCalledWith(ctx);
    expect(delegate.tokenRefreshed).toHaveBeenCalledWith(ctx);
    expect(delegate.logout).toHaveBeenCalledWith(ctx);
    // Non-failure events must NOT feed the detector.
    expect(detector.record).not.toHaveBeenCalled();
  });

  it('feeds a failed-login signal keyed by email and preserves audit logging', () => {
    const ctx = makeContext();
    logger.loginFailed(ctx, 'invalid_credentials');

    expect(delegate.loginFailed).toHaveBeenCalledWith(ctx, 'invalid_credentials');
    expect(detector.record).toHaveBeenCalledTimes(1);
    const signal = detector.record.mock.calls[0]?.[0] as SuspiciousActivitySignal;
    expect(signal.kind).toBe('failed_login');
    expect(signal.key).toBe('user@example.com');
    expect(signal.context).toMatchObject({ reason: 'invalid_credentials', ip_address: '203.0.113.7' });
  });

  it('feeds an account-locked signal', () => {
    logger.accountLocked(makeContext());

    expect(delegate.accountLocked).toHaveBeenCalledTimes(1);
    const signal = detector.record.mock.calls[0]?.[0] as SuspiciousActivitySignal;
    expect(signal.kind).toBe('account_locked');
    expect(signal.key).toBe('user@example.com');
  });

  it('falls back to IP then user id when the email is unknown', () => {
    logger.loginFailed(makeContext({ email: null }), 'user_not_found');
    const signal = detector.record.mock.calls[0]?.[0] as SuspiciousActivitySignal;
    expect(signal.key).toBe('203.0.113.7');
  });
});
