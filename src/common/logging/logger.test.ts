import { describe, it, expect } from 'vitest';
import type { Environment } from '@config/environment';
import { runWithContext, setTenantId, setUserId } from '@common/context';
import {
  REDACTED_PATHS,
  LOG_RETENTION,
  resolveLogLevel,
  contextMixin,
  buildLoggerOptions,
} from './logger.js';

/** Builds a minimal valid Environment for the logger builder under test. */
function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: 3000,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    DATABASE_POOL_MIN: 5,
    DATABASE_POOL_SIZE: 10,
    DATABASE_POOL_TIMEOUT: 10,
    CORS_ORIGIN: '',
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    CSRF_ENABLED: false,
    HSTS_MAX_AGE: 31_536_000,
    METRICS_ENABLED: true,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    JWT_ISSUER: 'carlos-erp',
    ERROR_ALERT_THRESHOLD: 10,
    ERROR_ALERT_WINDOW_MS: 60_000,
    ERROR_ALERT_COOLDOWN_MS: 300_000,
    SUSPICIOUS_ACTIVITY_THRESHOLD: 5,
    SUSPICIOUS_ACTIVITY_WINDOW_MS: 300_000,
    SUSPICIOUS_ACTIVITY_COOLDOWN_MS: 300_000,
    ...overrides,
  };
}

describe('resolveLogLevel', () => {
  it('derives debug for development when no explicit level is set', () => {
    expect(resolveLogLevel({ nodeEnv: 'development' })).toBe('debug');
  });

  it('derives silent for test when no explicit level is set', () => {
    expect(resolveLogLevel({ nodeEnv: 'test' })).toBe('silent');
  });

  it('derives info for production when no explicit level is set', () => {
    expect(resolveLogLevel({ nodeEnv: 'production' })).toBe('info');
  });

  it('lets an explicit level override the per-environment default', () => {
    expect(resolveLogLevel({ nodeEnv: 'production', explicitLevel: 'debug' })).toBe('debug');
    expect(resolveLogLevel({ nodeEnv: 'test', explicitLevel: 'warn' })).toBe('warn');
  });
});

describe('buildLoggerOptions', () => {
  it('uses the per-environment default when LOG_LEVEL is absent from the raw env', () => {
    const options = buildLoggerOptions(makeEnv({ NODE_ENV: 'production' }), {});
    expect(options.level).toBe('info');
  });

  it('uses the debug default for development when LOG_LEVEL is absent', () => {
    const options = buildLoggerOptions(makeEnv({ NODE_ENV: 'development' }), {});
    expect(options.level).toBe('debug');
  });

  it('honors an explicit LOG_LEVEL override present in the raw env', () => {
    const options = buildLoggerOptions(makeEnv({ NODE_ENV: 'production', LOG_LEVEL: 'trace' }), {
      LOG_LEVEL: 'trace',
    });
    expect(options.level).toBe('trace');
  });

  it('ignores an empty LOG_LEVEL and falls back to the per-environment default', () => {
    const options = buildLoggerOptions(makeEnv({ NODE_ENV: 'test' }), { LOG_LEVEL: '' });
    expect(options.level).toBe('silent');
  });

  it('configures secret redaction with removal for the sensitive paths', () => {
    const options = buildLoggerOptions(makeEnv(), {});
    const redact = options.redact;
    expect(redact).toBeTypeOf('object');
    // Narrow to the object form ({ paths, remove }).
    const redactObject = redact as { paths: string[]; remove?: boolean };
    expect(redactObject.remove).toBe(true);
    for (const path of ['password', 'passwordHash', 'token', 'accessToken', 'refreshToken']) {
      expect(redactObject.paths).toContain(path);
    }
    // Authorization / cookie headers are redacted in both request shapes.
    expect(redactObject.paths).toContain('req.headers.authorization');
    expect(redactObject.paths).toContain('headers.authorization');
  });

  it('emits an ISO-8601 timestamp field', () => {
    const options = buildLoggerOptions(makeEnv(), {});
    expect(options.timestamp).toBeTypeOf('function');
    const fragment = (options.timestamp as () => string)();
    // The fragment is `,"timestamp":"<iso>"` — extract and validate the value.
    const match = /^,"timestamp":"(.+)"$/.exec(fragment);
    expect(match).not.toBeNull();
    const iso = match?.[1] ?? '';
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('sets a service base field and the context mixin', () => {
    const options = buildLoggerOptions(makeEnv(), {});
    expect(options.base).toMatchObject({ service: 'carlos-backend' });
    expect(options.mixin).toBe(contextMixin);
  });

  it('does not configure pino-pretty transport (JSON only)', () => {
    const options = buildLoggerOptions(makeEnv({ NODE_ENV: 'development' }), {});
    expect(options.transport).toBeUndefined();
  });
});

describe('contextMixin', () => {
  it('returns request_id/tenant_id/user_id when run within a request context', () => {
    const fields = runWithContext({ requestId: 'req-1' }, () => {
      setTenantId('tenant-1');
      setUserId('user-1');
      return contextMixin();
    });

    expect(fields).toEqual({
      request_id: 'req-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
    });
  });

  it('omits tenant_id/user_id when the context has not resolved them yet', () => {
    const fields = runWithContext({ requestId: 'req-2' }, () => contextMixin());
    expect(fields).toEqual({ request_id: 'req-2' });
    expect(fields).not.toHaveProperty('tenant_id');
    expect(fields).not.toHaveProperty('user_id');
  });

  it('returns an empty object outside any request scope', () => {
    expect(contextMixin()).toEqual({});
  });
});

describe('LOG_RETENTION', () => {
  it('documents a platform-managed stdout log stream with a retention target', () => {
    expect(LOG_RETENTION.destination).toBe('stdout');
    expect(LOG_RETENTION.retentionDays).toBeGreaterThan(0);
  });
});

describe('REDACTED_PATHS', () => {
  it('covers nested payload variants for the core secrets', () => {
    expect(REDACTED_PATHS).toContain('*.password');
    expect(REDACTED_PATHS).toContain('*.passwordHash');
    expect(REDACTED_PATHS).toContain('*.refreshToken');
  });
});
