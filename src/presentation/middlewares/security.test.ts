import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect } from 'vitest';
import type { Environment } from '@config/environment';
import { enterContext } from '@common/context';
import { registerSecurity, parseAllowedOrigins } from './security.js';
import { registerErrorHandler } from './error-handler.js';

/** Base environment used by the tests; individual tests override fields. */
const baseConfig: Environment = {
  NODE_ENV: 'test',
  HOST: '0.0.0.0',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/carlos_test',
  DATABASE_POOL_MIN: 5,
  DATABASE_POOL_SIZE: 10,
  DATABASE_POOL_TIMEOUT: 10,
  CORS_ORIGIN: 'https://app.carlos-erp.com',
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
};

async function buildApp(overrides: Partial<Environment> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerSecurity(app, { ...baseConfig, ...overrides });
  registerErrorHandler(app);
  app.get('/ping', () => ({ ok: true }));
  app.post('/resource', () => ({ created: true }));
  await app.ready();
  return app;
}

describe('parseAllowedOrigins', () => {
  it('splits a comma-separated list and trims whitespace', () => {
    expect(parseAllowedOrigins('https://a.com, https://b.com ,https://c.com')).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('returns an empty list for a blank value', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('  ,  ')).toEqual([]);
  });
});

describe('security headers (Helmet)', () => {
  it('sets CSP, HSTS, and X-Frame-Options headers', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/ping' });

    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(response.headers['strict-transport-security']).toContain('includeSubDomains');
    expect(response.headers['x-frame-options']).toBe('DENY');

    await app.close();
  });
});

describe('CORS whitelist', () => {
  it('echoes the allow-origin header for a whitelisted origin', async () => {
    const app = await buildApp({ CORS_ORIGIN: 'https://app.carlos-erp.com' });
    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://app.carlos-erp.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('https://app.carlos-erp.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');

    await app.close();
  });

  it('withholds the allow-origin header for a non-whitelisted origin', async () => {
    const app = await buildApp({ CORS_ORIGIN: 'https://app.carlos-erp.com' });
    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://evil.example' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    // The request itself is not rejected server-side; the browser enforces CORS.
    expect(response.statusCode).toBe(200);

    await app.close();
  });
});

describe('rate limiting', () => {
  it('returns 429 with the consistent error envelope after exceeding the limit', async () => {
    const app = await buildApp({ RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 60_000 });

    const first = await app.inject({ method: 'GET', url: '/ping' });
    const second = await app.inject({ method: 'GET', url: '/ping' });
    const third = await app.inject({ method: 'GET', url: '/ping' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);

    const body = third.json() as Record<string, unknown>;
    expect(body.error_code).toBe('RATE_LIMITED');
    expect(typeof body.message).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(body).toHaveProperty('request_id');

    await app.close();
  });

  it('keys the limit by authenticated user id from the request context', async () => {
    // Seed the request context with a per-request user id (as the real
    // request-context middleware does) so the limiter keys by user, not IP.
    const app = Fastify({ logger: false });
    app.addHook('onRequest', (request, _reply, done) => {
      const user = request.headers['x-test-user'];
      enterContext(
        typeof user === 'string'
          ? { requestId: 'r', userId: user }
          : { requestId: 'r' },
      );
      done();
    });
    await registerSecurity(app, { ...baseConfig, RATE_LIMIT_MAX: 1, RATE_LIMIT_WINDOW_MS: 60_000 });
    registerErrorHandler(app);
    app.get('/ping', () => ({ ok: true }));
    await app.ready();

    // Different users share an IP but must not collide on the limiter key.
    const userA = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-test-user': 'user-a' },
    });
    const userB = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-test-user': 'user-b' },
    });
    // A second request from user-a exceeds that user's limit of 1.
    const userAAgain = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-test-user': 'user-a' },
    });

    expect(userA.statusCode).toBe(200);
    expect(userB.statusCode).toBe(200);
    expect(userAAgain.statusCode).toBe(429);

    await app.close();
  });
});

describe('CSRF protection', () => {
  it('is disabled by default and allows state-changing requests through', async () => {
    const app = await buildApp({ CSRF_ENABLED: false });
    const response = await app.inject({ method: 'POST', url: '/resource' });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('rejects cookie-based state-changing requests without a CSRF token when enabled', async () => {
    const app = await buildApp({ CSRF_ENABLED: true });
    const response = await app.inject({ method: 'POST', url: '/resource' });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('exempts Bearer-token (stateless JWT) requests from CSRF when enabled', async () => {
    const app = await buildApp({ CSRF_ENABLED: true });
    const response = await app.inject({
      method: 'POST',
      url: '/resource',
      headers: { authorization: 'Bearer fake.jwt.token' },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });
});
