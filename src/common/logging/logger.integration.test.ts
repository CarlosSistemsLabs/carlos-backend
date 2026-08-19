import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import type { Environment } from '@config/environment';
import { runWithContext, setTenantId, setUserId } from '@common/context';
import { buildLoggerOptions } from './logger.js';

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

interface CapturedLog {
  level?: string;
  timestamp?: string;
  service?: string;
  request_id?: string;
  tenant_id?: string;
  user_id?: string;
  password?: unknown;
  authorization?: unknown;
  msg?: string;
}

function buildCapturingLogger(lines: string[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
}

describe('logger config integration with Fastify', () => {
  it('constructs a Fastify logger from the built options without error', () => {
    const options = buildLoggerOptions(makeEnv({ LOG_LEVEL: 'info' }), { LOG_LEVEL: 'info' });
    const app = Fastify({ logger: { ...options, stream: new Writable({ write: (_c, _e, cb) => cb() }) } });
    expect(app.log).toBeDefined();
    expect(typeof app.log.info).toBe('function');
  });

  it('injects correlation ids via the mixin and emits JSON with an ISO timestamp', () => {
    const lines: string[] = [];
    const env = makeEnv({ LOG_LEVEL: 'info' });
    const app = Fastify({
      logger: { ...buildLoggerOptions(env, { LOG_LEVEL: 'info' }), stream: buildCapturingLogger(lines) },
    });

    runWithContext({ requestId: 'req-42' }, () => {
      setTenantId('tenant-9');
      setUserId('user-7');
      app.log.info('hello');
    });

    const entry = lines
      .join('')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as CapturedLog)
      .find((e) => e.msg === 'hello');

    expect(entry).toBeDefined();
    expect(entry?.request_id).toBe('req-42');
    expect(entry?.tenant_id).toBe('tenant-9');
    expect(entry?.user_id).toBe('user-7');
    expect(entry?.level).toBe('info');
    expect(entry?.service).toBe('carlos-backend');
    const iso = entry?.timestamp ?? '';
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('redacts sensitive fields from log payloads', () => {
    const lines: string[] = [];
    const env = makeEnv({ LOG_LEVEL: 'info' });
    const app = Fastify({
      logger: { ...buildLoggerOptions(env, { LOG_LEVEL: 'info' }), stream: buildCapturingLogger(lines) },
    });

    app.log.info({ password: 'super-secret', headers: { authorization: 'Bearer x' } }, 'sensitive');

    const entry = lines
      .join('')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as CapturedLog)
      .find((e) => e.msg === 'sensitive');

    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('password');
    // The nested authorization header is removed.
    const raw = lines.join('');
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toContain('Bearer x');
  });

  it('omits correlation fields when logging outside a request scope', () => {
    const lines: string[] = [];
    const env = makeEnv({ LOG_LEVEL: 'info' });
    const app = Fastify({
      logger: { ...buildLoggerOptions(env, { LOG_LEVEL: 'info' }), stream: buildCapturingLogger(lines) },
    });

    app.log.info('startup');

    const entry = lines
      .join('')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as CapturedLog)
      .find((e) => e.msg === 'startup');

    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('request_id');
    expect(entry).not.toHaveProperty('tenant_id');
    expect(entry).not.toHaveProperty('user_id');
  });
});
