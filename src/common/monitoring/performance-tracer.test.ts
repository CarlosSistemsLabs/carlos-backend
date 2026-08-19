import { describe, expect, it, vi } from 'vitest';
import { InMemoryMetrics, type IMetrics } from './metrics.js';
import {
  MetricsPerformanceTracer,
  NoopPerformanceTracer,
} from './performance-tracer.js';

/** Minimal recording fake so we can assert exactly what was recorded. */
function createRecordingMetrics(): {
  metrics: IMetrics;
  traces: { name: string; durationMs: number }[];
} {
  const traces: { name: string; durationMs: number }[] = [];
  const metrics: IMetrics = {
    recordRequest: () => undefined,
    incrementInFlight: () => undefined,
    decrementInFlight: () => undefined,
    recordDbQuery: () => undefined,
    recordTrace: (name, durationMs) => {
      traces.push({ name, durationMs });
    },
    snapshot: () => {
      throw new Error('not used');
    },
  };
  return { metrics, traces };
}

describe('MetricsPerformanceTracer.trace', () => {
  it('records the elapsed duration and returns the operation result', async () => {
    const { metrics, traces } = createRecordingMetrics();
    let t = 0;
    const clock = (): number => t;
    const tracer = new MetricsPerformanceTracer(metrics, clock);

    const result = await tracer.trace('report.generate', async () => {
      t = 42; // advance the clock during the operation
      return 'done';
    });

    expect(result).toBe('done');
    expect(traces).toEqual([{ name: 'report.generate', durationMs: 42 }]);
  });

  it('records the duration even when the operation rejects, then rethrows', async () => {
    const { metrics, traces } = createRecordingMetrics();
    let t = 0;
    const clock = (): number => t;
    const tracer = new MetricsPerformanceTracer(metrics, clock);
    const boom = new Error('boom');

    await expect(
      tracer.trace('report.generate', async () => {
        t = 10;
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(traces).toEqual([{ name: 'report.generate', durationMs: 10 }]);
  });
});

describe('MetricsPerformanceTracer.startTrace', () => {
  it('records the elapsed duration when the handle is stopped', () => {
    const { metrics, traces } = createRecordingMetrics();
    let t = 100;
    const clock = (): number => t;
    const tracer = new MetricsPerformanceTracer(metrics, clock);

    const handle = tracer.startTrace('batch.job');
    expect(handle.name).toBe('batch.job');
    t = 175;
    handle.stop();

    expect(traces).toEqual([{ name: 'batch.job', durationMs: 75 }]);
  });

  it('is idempotent: stopping twice records only once', () => {
    const { metrics, traces } = createRecordingMetrics();
    let t = 0;
    const tracer = new MetricsPerformanceTracer(metrics, () => t);

    const handle = tracer.startTrace('once');
    t = 5;
    handle.stop();
    t = 999;
    handle.stop();

    expect(traces).toHaveLength(1);
    expect(traces[0]).toEqual({ name: 'once', durationMs: 5 });
  });

  it('feeds durations into a real InMemoryMetrics snapshot under customTraces', () => {
    let t = 0;
    const metrics = new InMemoryMetrics(2048, () => t);
    const tracer = new MetricsPerformanceTracer(metrics, () => t);

    const handle = tracer.startTrace('checkout');
    t = 20;
    handle.stop();

    const snap = metrics.snapshot();
    const trace = snap.customTraces.find((entry) => entry.name === 'checkout');
    expect(trace).toBeDefined();
    expect(trace?.latency.count).toBe(1);
    expect(trace?.latency.p50).toBe(20);
  });
});

describe('NoopPerformanceTracer', () => {
  it('runs the operation and returns its result without recording', async () => {
    const tracer = new NoopPerformanceTracer();
    const op = vi.fn(async () => 'value');

    const result = await tracer.trace('anything', op);

    expect(result).toBe('value');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('rethrows the operation error without recording', async () => {
    const tracer = new NoopPerformanceTracer();
    const boom = new Error('boom');

    await expect(
      tracer.trace('anything', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('returns a stoppable handle that does nothing', () => {
    const tracer = new NoopPerformanceTracer();
    const handle = tracer.startTrace('noop');
    expect(handle.name).toBe('noop');
    expect(() => handle.stop()).not.toThrow();
  });
});
