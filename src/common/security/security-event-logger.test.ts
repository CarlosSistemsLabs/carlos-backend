import { describe, it, expect, vi } from 'vitest';
import { runWithContext } from '@common/context';
import {
  SECURITY_LOG_EVENT,
  SecurityEventLogger,
  NoopSecurityAuditLogger,
  type SecurityLogger,
} from './security-event-logger.js';

/** Captures the structured field object of the last `warn`/`info` call. */
function makeLogger(): SecurityLogger & {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  return { warn: vi.fn(), info: vi.fn() };
}

const FIXED_NOW = new Date('2024-01-02T03:04:05.000Z');

describe('SecurityEventLogger', () => {
  describe('authorizationDenied', () => {
    it('emits a structured security_event line at warn with the attempted action', () => {
      const logger = makeLogger();
      const audit = new SecurityEventLogger(logger, () => FIXED_NOW);

      audit.authorizationDenied({
        module: 'products',
        screen: 'list',
        action: 'write',
        reason: 'missing_permission',
        tenantId: 'tenant-1',
        userId: 'user-9',
        ipAddress: '10.0.0.1',
        requestId: 'req-42',
      });

      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [fields, msg] = logger.warn.mock.calls[0] as [Record<string, unknown>, string];
      expect(msg).toBe('security event');
      expect(fields).toMatchObject({
        event: SECURITY_LOG_EVENT,
        category: 'authorization',
        action: 'authorization_denied',
        outcome: 'failure',
        tenant_id: 'tenant-1',
        user_id: 'user-9',
        request_id: 'req-42',
        ip_address: '10.0.0.1',
        timestamp: FIXED_NOW.toISOString(),
        detail: {
          module: 'products',
          screen: 'list',
          action: 'write',
          reason: 'missing_permission',
        },
      });
    });

    it('never leaks credentials/tokens in the emitted fields', () => {
      const logger = makeLogger();
      const audit = new SecurityEventLogger(logger, () => FIXED_NOW);

      audit.authorizationDenied({
        module: 'admin',
        screen: 'settings',
        action: 'write',
        reason: 'role_not_found',
        tenantId: 'tenant-1',
        userId: 'user-9',
        ipAddress: '10.0.0.1',
        requestId: 'req-42',
      });

      const serialized = JSON.stringify(logger.warn.mock.calls[0]?.[0]);
      expect(serialized.toLowerCase()).not.toContain('password');
      expect(serialized.toLowerCase()).not.toContain('token');
      expect(serialized.toLowerCase()).not.toContain('secret');
    });

    it('falls back to the async request context for correlation fields', () => {
      const logger = makeLogger();
      const audit = new SecurityEventLogger(logger, () => FIXED_NOW);

      runWithContext(
        { requestId: 'ctx-req', tenantId: 'ctx-tenant', userId: 'ctx-user' },
        () => {
          audit.authorizationDenied({
            module: 'products',
            screen: 'list',
            action: 'read',
            reason: 'missing_permission',
          });
        },
      );

      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        tenant_id: 'ctx-tenant',
        user_id: 'ctx-user',
        request_id: 'ctx-req',
      });
    });
  });

  describe('rateLimitExceeded', () => {
    it('emits a suspicious_activity security_event line at warn', () => {
      const logger = makeLogger();
      const audit = new SecurityEventLogger(logger, () => FIXED_NOW);

      audit.rateLimitExceeded({
        ipAddress: '203.0.113.5',
        method: 'POST',
        path: '/api/v1/auth/login',
        userId: 'user-9',
        requestId: 'req-77',
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        event: SECURITY_LOG_EVENT,
        category: 'suspicious_activity',
        action: 'rate_limit_exceeded',
        outcome: 'failure',
        ip_address: '203.0.113.5',
        user_id: 'user-9',
        request_id: 'req-77',
        detail: { method: 'POST', path: '/api/v1/auth/login' },
      });
    });
  });
});

describe('NoopSecurityAuditLogger', () => {
  it('is a safe no-op for both event kinds', () => {
    const audit = new NoopSecurityAuditLogger();
    expect(() =>
      audit.authorizationDenied({
        module: 'm',
        screen: 's',
        action: 'a',
        reason: 'missing_permission',
      }),
    ).not.toThrow();
    expect(() =>
      audit.rateLimitExceeded({ ipAddress: '1.1.1.1', method: 'GET', path: '/x' }),
    ).not.toThrow();
  });
});
