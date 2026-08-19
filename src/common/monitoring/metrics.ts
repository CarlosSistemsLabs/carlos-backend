/**
 * Performance-metrics abstractions and an in-process implementation
 * (task 31.3, Requirements 21.6, 21.3).
 *
 * ## What is tracked (Requirement 21.6)
 * - **Request rate** — a monotonic total request counter plus per-`(method,
 *   route, status-class)` counters. The rate/second is derived on read from the
 *   total divided by process uptime.
 * - **Error rate** — the share of `5xx` responses (server errors) and, tracked
 *   separately, `4xx` responses (client errors) relative to the total.
 * - **Response-time percentiles** — p50/p95/p99 latency per route and overall,
 *   computed on read from a bounded sample reservoir (see below).
 * - **Database query duration** — percentiles over recorded query durations, fed
 *   via {@link IMetrics.recordDbQuery} (wired through a Prisma client extension —
 *   see `src/infrastructure/database/metrics-extension.ts`).
 * - **Active connections** — in-flight request gauge (incremented on request,
 *   decremented on response).
 * - **Memory usage** — sampled from `process.memoryUsage()` at scrape time.
 *
 * ## Percentile approach & trade-off
 * Latencies are retained in a fixed-capacity **ring-buffer reservoir** (default
 * {@link DEFAULT_RESERVOIR_CAPACITY} samples per series). Percentiles are
 * computed on read using the **nearest-rank** method over the retained window.
 *
 * Trade-off: this is dependency-free and O(capacity·log capacity) per scrape,
 * but it approximates the true distribution over a *recent window* rather than
 * all-time history — once more than `capacity` samples are observed the oldest
 * are overwritten. The reported `count` is the all-time total observed; the
 * percentiles/min/max describe only the retained window. For the modest sample
 * sizes used in tests (< capacity) the percentiles are exact. A production-grade
 * exporter (Prometheus histogram buckets / OpenTelemetry) can replace this
 * behind the same {@link IMetrics} interface without touching call sites.
 *
 * ## OpenTelemetry preparation (Requirement 21.3)
 * {@link IMetrics} is the single seam. All recording call sites (the Fastify
 * request hook and the Prisma extension) depend ONLY on this interface, never on
 * the concrete {@link InMemoryMetrics}. To adopt OpenTelemetry / prom-client
 * later, implement {@link IMetrics} over a `MeterProvider`/registry (map
 * `recordRequest` → a histogram + counter, `recordDbQuery` → a histogram, the
 * in-flight gauge → an up/down counter) and swap the instance registered in the
 * composition root. No hook, route, or repository code changes. The dependency
 * is intentionally NOT added yet.
 */

/** HTTP status class buckets used for request/error-rate accounting. */
export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

/** All status classes in ascending order (stable snapshot key order). */
export const STATUS_CLASSES: readonly StatusClass[] = ['1xx', '2xx', '3xx', '4xx', '5xx'];

/** Default per-series reservoir capacity (number of retained latency samples). */
export const DEFAULT_RESERVOIR_CAPACITY = 2048;

/** A single completed-request observation fed into the registry. */
export interface RequestMetricSample {
  /** HTTP method, e.g. `GET`. */
  readonly method: string;
  /** Normalized route pattern (NOT the raw URL), e.g. `/api/v1/products/:id`. */
  readonly route: string;
  /** Final response status code. */
  readonly statusCode: number;
  /** Wall-clock handling duration in milliseconds. */
  readonly durationMs: number;
}

/** Latency distribution summary (all values in milliseconds). */
export interface LatencySummary {
  /** All-time number of observations (may exceed retained sample count). */
  readonly count: number;
  /** Smallest retained sample (0 when no samples). */
  readonly min: number;
  /** Largest retained sample (0 when no samples). */
  readonly max: number;
  /** 50th percentile (median) over the retained window. */
  readonly p50: number;
  /** 95th percentile over the retained window. */
  readonly p95: number;
  /** 99th percentile over the retained window. */
  readonly p99: number;
}

/** Per-route rollup in a snapshot. */
export interface RouteMetricsSnapshot {
  readonly method: string;
  readonly route: string;
  readonly count: number;
  readonly statusClasses: Record<StatusClass, number>;
  readonly latency: LatencySummary;
}

/**
 * Per-named-trace rollup in a snapshot (task 33.4, Requirements 13.7, 21.9).
 *
 * A "custom trace" is an arbitrary, named span timed in application code via the
 * performance tracer (see `src/common/monitoring/performance-tracer.ts`) — the
 * backend analogue of a Firebase Performance *custom trace*. Durations are
 * grouped by trace `name`, so the label cardinality is bounded by the (fixed,
 * developer-chosen) set of trace names rather than by request data.
 */
export interface CustomTraceSnapshot {
  readonly name: string;
  readonly latency: LatencySummary;
}

/** Process memory sample (bytes), mirroring `process.memoryUsage()`. */
export interface MemorySnapshot {
  readonly rss: number;
  readonly heapTotal: number;
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

/** Full, serializable metrics snapshot returned by {@link IMetrics.snapshot}. */
export interface MetricsSnapshot {
  /** ISO-8601 timestamp the snapshot was taken. */
  readonly timestamp: string;
  /** Seconds since the registry was created. */
  readonly uptimeSeconds: number;
  readonly requests: {
    readonly total: number;
    /** total / uptimeSeconds (0 when uptime is 0). */
    readonly ratePerSecond: number;
    readonly statusClasses: Record<StatusClass, number>;
    /** 5xx / total (0 when total is 0). */
    readonly errorRate: number;
    /** 4xx / total (0 when total is 0). */
    readonly clientErrorRate: number;
    readonly latency: LatencySummary;
  };
  readonly routes: readonly RouteMetricsSnapshot[];
  readonly dbQuery: LatencySummary;
  /**
   * Named custom-trace duration summaries (task 33.4). Empty when no custom
   * trace has been recorded. Populated via {@link IMetrics.recordTrace}, driven
   * by the performance tracer.
   */
  readonly customTraces: readonly CustomTraceSnapshot[];
  /** In-flight request count at scrape time (active connections gauge). */
  readonly activeConnections: number;
  readonly memory: MemorySnapshot;
}

/**
 * Metrics recording port. This is the OpenTelemetry seam: production call sites
 * depend only on this interface, so the backing implementation
 * (in-memory today; an OTel meter / Prometheus registry later) can be swapped
 * without touching the hook, the Prisma extension, or the route.
 */
export interface IMetrics {
  /** Records one completed HTTP request (rate, status class, latency). */
  recordRequest(sample: RequestMetricSample): void;
  /** Increments the in-flight (active connections) gauge. */
  incrementInFlight(): void;
  /** Decrements the in-flight (active connections) gauge (never below 0). */
  decrementInFlight(): void;
  /** Records a single database query duration in milliseconds. */
  recordDbQuery(durationMs: number): void;
  /**
   * Records the duration (milliseconds) of a named custom trace/span
   * (task 33.4). Durations for the same `name` are aggregated into one latency
   * summary. This is the recording seam the performance tracer depends on; an
   * OpenTelemetry-backed {@link IMetrics} would map it to a per-name histogram.
   */
  recordTrace(name: string, durationMs: number): void;
  /** Produces a point-in-time, serializable snapshot of all metrics. */
  snapshot(): MetricsSnapshot;
}

/** Returns a fresh zeroed status-class counter map. */
function zeroStatusClasses(): Record<StatusClass, number> {
  return { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
}

/** Maps an HTTP status code to its {@link StatusClass}. Out-of-range → `5xx`. */
export function statusClassOf(statusCode: number): StatusClass {
  if (statusCode >= 100 && statusCode < 200) return '1xx';
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  return '5xx';
}

/**
 * Computes the nearest-rank percentile of an ascending-sorted array.
 *
 * `rank = ceil((p/100) * n)`, then the value at `rank - 1` (clamped to
 * `[0, n-1]`) is returned. For `[1..100]` this yields p50=50, p95=95, p99=99.
 * Returns 0 for an empty input.
 */
export function nearestRankPercentile(sortedAscending: readonly number[], p: number): number {
  const n = sortedAscending.length;
  if (n === 0) return 0;
  const rank = Math.ceil((p / 100) * n);
  const index = Math.min(Math.max(rank - 1, 0), n - 1);
  return sortedAscending[index] ?? 0;
}

/**
 * Fixed-capacity ring-buffer reservoir of numeric samples. Retains the most
 * recent `capacity` samples and tracks the all-time observation count.
 */
export class Reservoir {
  private readonly buffer: number[] = [];
  private cursor = 0;
  private observed = 0;

  constructor(private readonly capacity: number = DEFAULT_RESERVOIR_CAPACITY) {
    if (capacity <= 0) {
      throw new Error('Reservoir capacity must be a positive integer');
    }
  }

  /** Adds a sample, overwriting the oldest once at capacity. */
  public add(value: number): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(value);
    } else {
      this.buffer[this.cursor] = value;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    this.observed += 1;
  }

  /** All-time number of observations (may exceed retained sample count). */
  public get count(): number {
    return this.observed;
  }

  /** Summarizes the retained window into a {@link LatencySummary}. */
  public summary(): LatencySummary {
    if (this.buffer.length === 0) {
      return { count: this.observed, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    }
    const sorted = [...this.buffer].sort((a, b) => a - b);
    return {
      count: this.observed,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      p50: nearestRankPercentile(sorted, 50),
      p95: nearestRankPercentile(sorted, 95),
      p99: nearestRankPercentile(sorted, 99),
    };
  }
}

/** Per-route accumulator (counts + latency reservoir). */
class RouteAccumulator {
  public count = 0;
  public readonly statusClasses = zeroStatusClasses();
  public readonly latency: Reservoir;

  constructor(
    public readonly method: string,
    public readonly route: string,
    capacity: number,
  ) {
    this.latency = new Reservoir(capacity);
  }
}

/**
 * In-process {@link IMetrics} implementation. Thread-safety is not a concern in
 * Node's single-threaded event loop; all mutations are synchronous.
 */
export class InMemoryMetrics implements IMetrics {
  private totalRequests = 0;
  private readonly overallStatusClasses = zeroStatusClasses();
  private readonly overallLatency: Reservoir;
  private readonly dbLatency: Reservoir;
  private readonly routes = new Map<string, RouteAccumulator>();
  private readonly customTraces = new Map<string, Reservoir>();
  private inFlight = 0;
  private readonly startedAtMs: number;

  constructor(
    private readonly capacity: number = DEFAULT_RESERVOIR_CAPACITY,
    private readonly now: () => number = () => Date.now(),
    private readonly memoryUsage: () => NodeJS.MemoryUsage = () => process.memoryUsage(),
  ) {
    this.overallLatency = new Reservoir(capacity);
    this.dbLatency = new Reservoir(capacity);
    this.startedAtMs = now();
  }

  public recordRequest(sample: RequestMetricSample): void {
    const cls = statusClassOf(sample.statusCode);
    this.totalRequests += 1;
    this.overallStatusClasses[cls] += 1;
    this.overallLatency.add(sample.durationMs);

    const key = `${sample.method} ${sample.route}`;
    let acc = this.routes.get(key);
    if (acc === undefined) {
      acc = new RouteAccumulator(sample.method, sample.route, this.capacity);
      this.routes.set(key, acc);
    }
    acc.count += 1;
    acc.statusClasses[cls] += 1;
    acc.latency.add(sample.durationMs);
  }

  public incrementInFlight(): void {
    this.inFlight += 1;
  }

  public decrementInFlight(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  public recordDbQuery(durationMs: number): void {
    this.dbLatency.add(durationMs);
  }

  public recordTrace(name: string, durationMs: number): void {
    let reservoir = this.customTraces.get(name);
    if (reservoir === undefined) {
      reservoir = new Reservoir(this.capacity);
      this.customTraces.set(name, reservoir);
    }
    reservoir.add(durationMs);
  }

  public snapshot(): MetricsSnapshot {
    const nowMs = this.now();
    const uptimeSeconds = Math.max(0, (nowMs - this.startedAtMs) / 1000);
    const total = this.totalRequests;
    const mem = this.memoryUsage();

    const routes: RouteMetricsSnapshot[] = [...this.routes.values()].map((acc) => ({
      method: acc.method,
      route: acc.route,
      count: acc.count,
      statusClasses: { ...acc.statusClasses },
      latency: acc.latency.summary(),
    }));

    return {
      timestamp: new Date(nowMs).toISOString(),
      uptimeSeconds,
      requests: {
        total,
        ratePerSecond: uptimeSeconds > 0 ? total / uptimeSeconds : 0,
        statusClasses: { ...this.overallStatusClasses },
        errorRate: total > 0 ? this.overallStatusClasses['5xx'] / total : 0,
        clientErrorRate: total > 0 ? this.overallStatusClasses['4xx'] / total : 0,
        latency: this.overallLatency.summary(),
      },
      routes,
      dbQuery: this.dbLatency.summary(),
      customTraces: [...this.customTraces.entries()].map(([name, reservoir]) => ({
        name,
        latency: reservoir.summary(),
      })),
      activeConnections: this.inFlight,
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
    };
  }
}

/**
 * Times an async database operation and records its duration via
 * {@link IMetrics.recordDbQuery}. Framework-agnostic so it can be unit-tested
 * without Prisma; the Prisma client extension
 * (`src/infrastructure/database/metrics-extension.ts`) delegates to it.
 *
 * The duration is recorded whether the operation resolves or rejects, and the
 * original result/error is propagated unchanged so behavior is never altered.
 */
export async function timeDbOperation<T>(
  metrics: IMetrics,
  operation: () => Promise<T>,
  clock: () => number = () => performance.now(),
): Promise<T> {
  const start = clock();
  try {
    return await operation();
  } finally {
    metrics.recordDbQuery(clock() - start);
  }
}
