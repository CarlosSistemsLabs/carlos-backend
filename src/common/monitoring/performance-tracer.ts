import type { IMetrics } from './metrics.js';

/**
 * Performance tracing abstraction (task 33.4, Requirements 13.7, 21.9).
 *
 * ## Scope: backend custom traces vs. Firebase Performance Monitoring
 * Firebase Performance Monitoring is primarily a **client** SDK (web / Android /
 * iOS): it measures screen render/load times and network-request timing *from
 * the device*. There is no server-side Firebase Performance SDK. On the backend
 * the equivalent concern — "how long did operation X take?" — is served by the
 * in-process metrics registry ({@link IMetrics}) established in task 31.3:
 * - **API response times** are already captured by the Fastify request hook
 *   (`registerRequestMetrics`) as per-route p50/p95/p99 latency.
 * - **Database query performance** is captured via {@link IMetrics.recordDbQuery}
 *   (fed by the Prisma metrics extension — see
 *   `src/infrastructure/database/metrics-extension.ts`).
 *
 * What was missing is a way to time *arbitrary named operations* (a report
 * generation, a batch job, an external call) — the backend analogue of a
 * Firebase Performance **custom trace**. This module provides that seam without
 * duplicating the request/DB tracking above: a trace's duration is recorded via
 * {@link IMetrics.recordTrace}, so custom traces surface in the same `/metrics`
 * snapshot (`customTraces`) as everything else and inherit the same
 * OpenTelemetry migration path.
 *
 * ## Screen load times (Requirement 13.7)
 * Screen/page load timing is inherently client-side and is implemented in the
 * Web (task 45+), Android (task 51.3) and iOS (task 56.3) clients using the
 * Firebase Performance client SDKs. The backend only exposes this custom-trace
 * seam; it does not — and cannot — measure client screen loads.
 */

/**
 * A started, not-yet-finished trace. Call {@link stop} exactly once to record
 * the elapsed duration. Calling {@link stop} more than once is a no-op after the
 * first call so a duration is never double-counted.
 */
export interface TraceHandle {
  /** The trace name this handle records under. */
  readonly name: string;
  /** Records the elapsed duration since the trace started (idempotent). */
  stop(): void;
}

/**
 * Times named operations ("custom traces"). The single seam application code
 * depends on; the default implementation feeds durations into {@link IMetrics},
 * and a {@link NoopPerformanceTracer} disables tracing with zero overhead.
 */
export interface IPerformanceTracer {
  /**
   * Starts a trace and returns a handle whose {@link TraceHandle.stop} records
   * the elapsed duration. Use for spans whose start and end are not lexically
   * scoped; prefer {@link trace} when they are.
   */
  startTrace(name: string): TraceHandle;
  /**
   * Times an async operation, recording its duration whether it resolves or
   * rejects, and returns the operation's result (or rethrows its error)
   * unchanged so behaviour is never altered.
   */
  trace<T>(name: string, operation: () => Promise<T>): Promise<T>;
}

/**
 * {@link IPerformanceTracer} that records trace durations into an
 * {@link IMetrics} registry via {@link IMetrics.recordTrace}. Durations for the
 * same trace name are aggregated into one latency summary and exposed on the
 * `/metrics` snapshot under `customTraces`.
 *
 * The clock is injectable for deterministic tests; it defaults to
 * `performance.now()` (monotonic, sub-millisecond), mirroring
 * {@link timeDbOperation}.
 */
export class MetricsPerformanceTracer implements IPerformanceTracer {
  constructor(
    private readonly metrics: IMetrics,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  public startTrace(name: string): TraceHandle {
    const start = this.clock();
    let stopped = false;
    const record = (): void => {
      this.metrics.recordTrace(name, this.clock() - start);
    };
    return {
      name,
      stop: () => {
        if (stopped) return;
        stopped = true;
        record();
      },
    };
  }

  public async trace<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const handle = this.startTrace(name);
    try {
      return await operation();
    } finally {
      handle.stop();
    }
  }
}

/**
 * No-op {@link IPerformanceTracer}: never records anything, but still runs and
 * returns the traced operation's result. Use when performance tracing is
 * disabled, or as a safe default in contexts without a metrics registry.
 */
export class NoopPerformanceTracer implements IPerformanceTracer {
  public startTrace(name: string): TraceHandle {
    return { name, stop: () => undefined };
  }

  public async trace<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}
