import { describe, expect, it } from 'vitest';
import {
  InMemoryMetrics,
  Reservoir,
  nearestRankPercentile,
  statusClassOf,
  timeDbOperation,
  type MetricsSnapshot,
} from './metrics.js';

describe('nearestRankPercentile', () => {
  it('returns 0 for an empty sample set', () => {
    expect(nearestRankPercentile([], 50)).toBe(0);
    expect(nearestRankPercentile([], 99)).toBe(0);
  });

  it('computes p50/p95/p99 of 1..100 via nearest-rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(nearestRankPercentile(sorted, 50)).toBe(50);
    expect(nearestRankPercentile(sorted, 95)).toBe(95);
    expect(nearestRankPercentile(sorted, 99)).toBe(99);
  });

  it('handles a single-element set for all percentiles', () => {
    expect(nearestRankPercentile([42], 50)).toBe(42);
    expect(nearestRankPercentile([42], 95)).toBe(42);
    expect(nearestRankPercentile([42], 99)).toBe(42);
  });

  it('clamps p100 to the maximum element', () => {
    expect(nearestRankPercentile([10, 20, 30], 100)).toBe(30);
  });
});

describe('statusClassOf', () => {
  it('maps codes to their class', () => {
    expect(statusClassOf(100)).toBe('1xx');
    expect(statusClassOf(200)).toBe('2xx');
    expect(statusClassOf(301)).toBe('3xx');
    expect(statusClassOf(404)).toBe('4xx');
    expect(statusClassOf(500)).toBe('5xx');
  });

  it('buckets out-of-range codes into 5xx', () => {
    expect(statusClassOf(0)).toBe('5xx');
    expect(statusClassOf(600)).toBe('5xx');
  });
});

describe('Reservoir', () => {
  it('summarizes exactly when below capacity', () => {
    const r = new Reservoir(100);
    for (let i = 1; i <= 50; i += 1) r.add(i);
    const s = r.summary();
    expect(s.count).toBe(50);
    expect(s.min).toBe(1);
    expect(s.max).toBe(50);
    expect(s.p50).toBe(25);
    expect(s.p95).toBe(48);
    expect(s.p99).toBe(50);
  });

  it('retains only the most recent samples once at capacity but counts all', () => {
    const r = new Reservoir(3);
    r.add(1);
    r.add(2);
    r.add(3);
    r.add(4); // overwrites the oldest (1)
    const s = r.summary();
    expect(s.count).toBe(4); // all-time observations
    expect(s.min).toBe(2); // window is [2,3,4]
    expect(s.max).toBe(4);
  });

  it('returns zeros for an empty reservoir', () => {
    const s = new Reservoir(10).summary();
    expect(s).toEqual({ count: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 });
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new Reservoir(0)).toThrow();
  });
});

describe('InMemoryMetrics', () => {
  it('tracks total requests, status classes and error/client-error rates', () => {
    const m = new InMemoryMetrics();
    m.recordRequest({ method: 'GET', route: '/a', statusCode: 200, durationMs: 5 });
    m.recordRequest({ method: 'GET', route: '/a', statusCode: 200, durationMs: 7 });
    m.recordRequest({ method: 'GET', route: '/a', statusCode: 404, durationMs: 3 });
    m.recordRequest({ method: 'GET', route: '/a', statusCode: 500, durationMs: 9 });

    const snap = m.snapshot();
    expect(snap.requests.total).toBe(4);
    expect(snap.requests.statusClasses).toEqual({
      '1xx': 0,
      '2xx': 2,
      '3xx': 0,
      '4xx': 1,
      '5xx': 1,
    });
    expect(snap.requests.errorRate).toBeCloseTo(0.25);
    expect(snap.requests.clientErrorRate).toBeCloseTo(0.25);
  });

  it('reports zero rates when no requests were recorded', () => {
    const snap = new InMemoryMetrics().snapshot();
    expect(snap.requests.total).toBe(0);
    expect(snap.requests.errorRate).toBe(0);
    expect(snap.requests.clientErrorRate).toBe(0);
    expect(snap.requests.ratePerSecond).toBe(0);
  });

  it('groups latency per (method, route)', () => {
    const m = new InMemoryMetrics();
    for (let i = 1; i <= 100; i += 1) {
      m.recordRequest({ method: 'GET', route: '/products/:id', statusCode: 200, durationMs: i });
    }
    m.recordRequest({ method: 'POST', route: '/products', statusCode: 201, durationMs: 42 });

    const snap = m.snapshot();
    const get = snap.routes.find((r) => r.method === 'GET' && r.route === '/products/:id');
    const post = snap.routes.find((r) => r.method === 'POST' && r.route === '/products');
    expect(get?.count).toBe(100);
    expect(get?.latency.p50).toBe(50);
    expect(get?.latency.p95).toBe(95);
    expect(get?.latency.p99).toBe(99);
    expect(post?.count).toBe(1);
    expect(post?.latency.p50).toBe(42);
  });

  it('computes a rate/second and timestamp from an injected clock', () => {
    let nowMs = 1_000_000;
    const m = new InMemoryMetrics(2048, () => nowMs);
    for (let i = 0; i < 10; i += 1) {
      m.recordRequest({ method: 'GET', route: '/a', statusCode: 200, durationMs: 1 });
    }
    nowMs += 5_000; // 5 seconds elapsed
    const snap = m.snapshot();
    expect(snap.uptimeSeconds).toBe(5);
    expect(snap.requests.ratePerSecond).toBeCloseTo(2); // 10 requests / 5s
    expect(snap.timestamp).toBe(new Date(nowMs).toISOString());
  });

  it('tracks the in-flight (active connections) gauge and never goes below zero', () => {
    const m = new InMemoryMetrics();
    m.incrementInFlight();
    m.incrementInFlight();
    expect(m.snapshot().activeConnections).toBe(2);
    m.decrementInFlight();
    expect(m.snapshot().activeConnections).toBe(1);
    m.decrementInFlight();
    m.decrementInFlight(); // extra decrement is clamped
    expect(m.snapshot().activeConnections).toBe(0);
  });

  it('records database query durations into the dbQuery summary', () => {
    const m = new InMemoryMetrics();
    for (let i = 1; i <= 100; i += 1) m.recordDbQuery(i);
    const snap = m.snapshot();
    expect(snap.dbQuery.count).toBe(100);
    expect(snap.dbQuery.p50).toBe(50);
    expect(snap.dbQuery.p95).toBe(95);
    expect(snap.dbQuery.p99).toBe(99);
  });

  it('groups custom-trace durations by name in the customTraces summary', () => {
    const m = new InMemoryMetrics();
    for (let i = 1; i <= 100; i += 1) m.recordTrace('report.generate', i);
    m.recordTrace('checkout', 7);

    const snap = m.snapshot();
    const report = snap.customTraces.find((t) => t.name === 'report.generate');
    const checkout = snap.customTraces.find((t) => t.name === 'checkout');

    expect(snap.customTraces).toHaveLength(2);
    expect(report?.latency.count).toBe(100);
    expect(report?.latency.p50).toBe(50);
    expect(report?.latency.p99).toBe(99);
    expect(checkout?.latency.count).toBe(1);
    expect(checkout?.latency.p50).toBe(7);
  });

  it('reports an empty customTraces list when none were recorded', () => {
    expect(new InMemoryMetrics().snapshot().customTraces).toEqual([]);
  });

  it('includes a process memory sample', () => {
    const m = new InMemoryMetrics(2048, () => Date.now(), () => ({
      rss: 111,
      heapTotal: 222,
      heapUsed: 123,
      external: 44,
      arrayBuffers: 5,
    }));
    const snap: MetricsSnapshot = m.snapshot();
    expect(snap.memory).toEqual({
      rss: 111,
      heapTotal: 222,
      heapUsed: 123,
      external: 44,
      arrayBuffers: 5,
    });
  });

  it('uses the real process.memoryUsage by default', () => {
    const snap = new InMemoryMetrics().snapshot();
    expect(snap.memory.rss).toBeGreaterThan(0);
    expect(snap.memory.heapUsed).toBeGreaterThan(0);
  });
});

describe('timeDbOperation', () => {
  it('records the elapsed duration and returns the operation result', async () => {
    const m = new InMemoryMetrics();
    let t = 0;
    const clock = (): number => t;
    const result = await timeDbOperation(
      m,
      async () => {
        t = 25; // simulate 25ms elapsed
        return 'ok';
      },
      clock,
    );
    expect(result).toBe('ok');
    const snap = m.snapshot();
    expect(snap.dbQuery.count).toBe(1);
    expect(snap.dbQuery.max).toBe(25);
  });

  it('records duration even when the operation rejects and rethrows', async () => {
    const m = new InMemoryMetrics();
    let t = 0;
    const clock = (): number => t;
    await expect(
      timeDbOperation(
        m,
        async () => {
          t = 10;
          throw new Error('db boom');
        },
        clock,
      ),
    ).rejects.toThrow('db boom');
    expect(m.snapshot().dbQuery.count).toBe(1);
    expect(m.snapshot().dbQuery.max).toBe(10);
  });
});
