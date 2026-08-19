import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMetrics } from './metrics.js';
import { registerMetricsRoutes } from './metrics.routes.js';
import { registerRequestMetrics } from './request-metrics.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

async function buildApp(
  metrics: InMemoryMetrics,
  enabled?: boolean,
): Promise<FastifyInstance> {
  const instance = Fastify();
  registerRequestMetrics(instance, metrics);
  instance.get('/ok', (_req, reply) => reply.status(200).send({ ok: true }));
  await registerMetricsRoutes(instance, {
    metrics,
    ...(enabled !== undefined ? { enabled } : {}),
  });
  await instance.ready();
  return instance;
}

describe('GET /metrics', () => {
  it('returns the full snapshot shape as JSON', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics);

    // Generate some traffic first so the snapshot has non-trivial content.
    await app.inject({ method: 'GET', url: '/ok' });

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.requests).toMatchObject({
      total: expect.any(Number),
      ratePerSecond: expect.any(Number),
      errorRate: expect.any(Number),
      clientErrorRate: expect.any(Number),
    });
    expect(body.requests.statusClasses).toHaveProperty('2xx');
    expect(body.requests.latency).toHaveProperty('p95');
    expect(Array.isArray(body.routes)).toBe(true);
    expect(body.dbQuery).toHaveProperty('p99');
    expect(typeof body.activeConnections).toBe('number');
    expect(body.memory).toHaveProperty('heapUsed');
    expect(body.memory.rss).toBeGreaterThan(0);
  });

  it('reflects recorded db-query stats in the snapshot', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics);
    metrics.recordDbQuery(12);
    metrics.recordDbQuery(34);

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.json().dbQuery.count).toBe(2);
  });

  it('does not register the route when disabled', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics, false);

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(404);
  });
});
