import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HealthCheckRegistry,
  createDatabaseHealthCheck,
  type HealthCheckResult,
  type IHealthCheck,
} from '../application/health-check.js';
import { registerHealthRoutes } from './health.routes.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

/** Builds a bare Fastify app with only the public health routes registered. */
async function buildHealthApp(
  registry: HealthCheckRegistry,
  readinessTimeoutMs?: number,
): Promise<FastifyInstance> {
  const instance = Fastify();
  await registerHealthRoutes(instance, {
    registry,
    ...(readinessTimeoutMs !== undefined ? { readinessTimeoutMs } : {}),
  });
  await instance.ready();
  return instance;
}

/** A controllable check for the route tests. */
function fakeCheck(
  name: string,
  result: HealthCheckResult | (() => Promise<HealthCheckResult>),
  critical = true,
): IHealthCheck {
  return {
    name,
    critical,
    check: typeof result === 'function' ? result : async () => result,
  };
}

describe('GET /health/liveness', () => {
  it('returns 200 { status: "ok" }', async () => {
    const registry = new HealthCheckRegistry();
    app = await buildHealthApp(registry);

    const response = await app.inject({ method: 'GET', url: '/health/liveness' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('stays 200 even when a critical dependency check would fail (dependency-free)', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(
      createDatabaseHealthCheck(async () => {
        throw new Error('database down');
      }),
    );
    app = await buildHealthApp(registry);

    const response = await app.inject({ method: 'GET', url: '/health/liveness' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /health/readiness', () => {
  it('returns 200 ready with per-check statuses when all checks are up', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(createDatabaseHealthCheck(async () => [{ '?column?': 1 }]));
    app = await buildHealthApp(registry);

    const response = await app.inject({ method: 'GET', url: '/health/readiness' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', checks: { database: 'up' } });
  });

  it('returns 503 not_ready when the database pinger rejects', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(
      createDatabaseHealthCheck(async () => {
        throw new Error('connection refused');
      }),
    );
    app = await buildHealthApp(registry);

    const response = await app.inject({ method: 'GET', url: '/health/readiness' });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks).toEqual({ database: 'down' });
    expect(body.details.database).toBe('connection refused');
  });

  it('returns 503 not_ready when a critical check hangs past the timeout', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(
      fakeCheck(
        'database',
        () =>
          new Promise<HealthCheckResult>((resolve) => {
            setTimeout(() => resolve({ status: 'up' }), 1000);
          }),
      ),
    );
    app = await buildHealthApp(registry, 20);

    const response = await app.inject({ method: 'GET', url: '/health/readiness' });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.database).toBe('down');
    expect(body.details.database).toContain('timeout');
  });

  it('reports every registered check with its individual status', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(fakeCheck('database', { status: 'up' }));
    registry.register(fakeCheck('redis', { status: 'down', detail: 'not configured' }, false));
    app = await buildHealthApp(registry);

    const response = await app.inject({ method: 'GET', url: '/health/readiness' });

    // Redis is non-critical, so overall readiness is still 200/ready.
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({ database: 'up', redis: 'down' });
  });
});
