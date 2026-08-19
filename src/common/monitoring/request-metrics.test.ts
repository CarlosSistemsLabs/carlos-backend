import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMetrics } from './metrics.js';
import { normalizeRoute, registerRequestMetrics } from './request-metrics.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

/** Builds a bare app with metrics hooks and a few test routes. */
async function buildApp(metrics: InMemoryMetrics): Promise<FastifyInstance> {
  const instance = Fastify();
  registerRequestMetrics(instance, metrics);

  instance.get('/ok', (_req, reply) => reply.status(200).send({ ok: true }));
  instance.get('/boom', (_req, reply) => reply.status(500).send({ error: true }));
  instance.get('/items/:id', (req, reply) =>
    reply.status(200).send({ id: (req.params as { id: string }).id }),
  );

  await instance.ready();
  return instance;
}

describe('normalizeRoute', () => {
  it('returns the matched route pattern when present', () => {
    expect(normalizeRoute({ routeOptions: { url: '/api/v1/products/:id' } } as never)).toBe(
      '/api/v1/products/:id',
    );
  });

  it('falls back to "unmatched" when there is no route template', () => {
    expect(normalizeRoute({ routeOptions: { url: undefined } } as never)).toBe('unmatched');
    expect(normalizeRoute({ routeOptions: {} } as never)).toBe('unmatched');
  });
});

describe('registerRequestMetrics', () => {
  it('counts requests and buckets status classes (200 vs 500)', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics);

    await app.inject({ method: 'GET', url: '/ok' });
    await app.inject({ method: 'GET', url: '/ok' });
    await app.inject({ method: 'GET', url: '/boom' });

    const snap = metrics.snapshot();
    expect(snap.requests.total).toBe(3);
    expect(snap.requests.statusClasses['2xx']).toBe(2);
    expect(snap.requests.statusClasses['5xx']).toBe(1);
    expect(snap.requests.errorRate).toBeCloseTo(1 / 3);
  });

  it('records a latency sample per request', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics);

    await app.inject({ method: 'GET', url: '/ok' });

    const snap = metrics.snapshot();
    expect(snap.requests.latency.count).toBe(1);
    // elapsedTime is a non-negative number of milliseconds.
    expect(snap.requests.latency.max).toBeGreaterThanOrEqual(0);
  });

  it('collapses dynamic :id params to the route pattern (no cardinality explosion)', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics);

    await app.inject({ method: 'GET', url: '/items/1' });
    await app.inject({ method: 'GET', url: '/items/2' });
    await app.inject({ method: 'GET', url: '/items/abc-uuid-999' });

    const snap = metrics.snapshot();
    const itemRoutes = snap.routes.filter((r) => r.route === '/items/:id');
    expect(itemRoutes).toHaveLength(1);
    expect(itemRoutes[0]?.count).toBe(3);
    // The raw ids must NOT appear as distinct route labels.
    expect(snap.routes.some((r) => r.route.includes('abc-uuid-999'))).toBe(false);
  });

  it('buckets unmatched (404) requests under a single "unmatched" label', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics);

    await app.inject({ method: 'GET', url: '/does-not-exist-1' });
    await app.inject({ method: 'GET', url: '/does-not-exist-2' });

    const snap = metrics.snapshot();
    const unmatched = snap.routes.filter((r) => r.route === 'unmatched');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]?.count).toBe(2);
  });

  it('balances the in-flight gauge back to zero after responses complete', async () => {
    const metrics = new InMemoryMetrics();
    app = await buildApp(metrics);

    await app.inject({ method: 'GET', url: '/ok' });
    await app.inject({ method: 'GET', url: '/boom' });

    expect(metrics.snapshot().activeConnections).toBe(0);
  });
});
