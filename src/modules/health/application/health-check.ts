/**
 * Health-check abstractions for the readiness probe (task 31.2, Requirement 21.4).
 *
 * The backend exposes two orchestration probes:
 *
 * - **Liveness** (`/health/liveness`) answers "is the process up?". It performs
 *   NO dependency checks — see the route module for the rationale.
 * - **Readiness** (`/health/readiness`) answers "can the process serve
 *   traffic?". It runs every check registered on a {@link HealthCheckRegistry}
 *   (database connectivity today; Redis / external services later) and reports
 *   an aggregate plus a per-check status.
 *
 * Checks depend only on the framework-agnostic {@link IHealthCheck} port so the
 * concrete dependency (Prisma, Redis, an HTTP client, …) can change without
 * touching the probe. Every check is exercised behind a per-check timeout so a
 * single hung dependency can never hang the probe (a timed-out check is simply
 * reported as `down`).
 */

/** Outcome of a single dependency probe. */
export type HealthStatus = 'up' | 'down';

/** Result of running one {@link IHealthCheck}. */
export interface HealthCheckResult {
  /** Whether the dependency responded successfully. */
  status: HealthStatus;
  /** Optional human-readable detail (populated on `down`: error message / timeout). */
  detail?: string;
}

/**
 * A named dependency probe.
 *
 * Implementations MUST resolve — a rejected promise is treated as `down` by the
 * registry, but implementations are encouraged to catch and return a descriptive
 * {@link HealthCheckResult.detail}. A `critical` check that is `down` fails the
 * readiness probe (503); a non-critical check that is `down` is reported but
 * does not fail readiness (e.g. an optional cache).
 */
export interface IHealthCheck {
  /** Stable identifier surfaced in the readiness response (e.g. `database`). */
  readonly name: string;
  /** When true, a `down` result flips the overall readiness to `not_ready`. */
  readonly critical: boolean;
  /** Probe the dependency. Should resolve; rejection is coerced to `down`. */
  check(): Promise<HealthCheckResult>;
}

/** Aggregate outcome of running every registered check. */
export interface HealthReport {
  /** `ready` when all critical checks are `up`; otherwise `not_ready`. */
  status: 'ready' | 'not_ready';
  /** Per-check status keyed by check name, e.g. `{ database: 'up' }`. */
  checks: Record<string, HealthStatus>;
  /** Details for checks that reported `down` (present only when non-empty). */
  details?: Record<string, string>;
}

/** Default per-check timeout (ms) applied by {@link HealthCheckRegistry.runAll}. */
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 2000;

/**
 * Races a promise against a timeout, resolving to `onTimeout()` if the promise
 * does not settle within `ms`. The timer is always cleared so it never keeps
 * the event loop alive.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(onTimeout());
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Generic {@link IHealthCheck} backed by a "ping" function. Any dependency can
 * be health-checked by wrapping a probe that resolves on success and rejects on
 * failure — the database check uses `prisma.$queryRaw`SELECT 1``, and the Redis
 * / external-service checks (wired in tasks 39.1 / 33.x) will pass their own
 * ping (e.g. `redis.ping()`) behind this same class so the registry and probe
 * are unchanged when they land.
 */
export class PingHealthCheck implements IHealthCheck {
  public readonly name: string;
  public readonly critical: boolean;
  private readonly ping: () => Promise<unknown>;

  constructor(
    name: string,
    ping: () => Promise<unknown>,
    options: { critical?: boolean } = {},
  ) {
    this.name = name;
    this.ping = ping;
    this.critical = options.critical ?? true;
  }

  public async check(): Promise<HealthCheckResult> {
    try {
      await this.ping();
      return { status: 'up' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'dependency unreachable';
      return { status: 'down', detail };
    }
  }
}

/**
 * Builds the `database` connectivity check. `ping` typically runs
 * `prisma.$queryRaw`SELECT 1`` in production; tests inject a fake that resolves
 * or rejects so the readiness endpoint can be exercised without a live database.
 * The database is a critical dependency — if it is unreachable the backend
 * cannot serve traffic, so readiness returns 503.
 */
export function createDatabaseHealthCheck(ping: () => Promise<unknown>): IHealthCheck {
  return new PingHealthCheck('database', ping, { critical: true });
}

/**
 * Registry of named health checks driving the readiness probe.
 *
 * Checks are registered at composition time (see `buildServer`). Today only the
 * `database` check is registered; the Redis check (task 39.1) and
 * external-service checks (task 33.x) register the SAME {@link IHealthCheck}
 * port conditionally — absent until those dependencies are configured — so no
 * probe/route change is required when they are wired.
 */
export class HealthCheckRegistry {
  private readonly checks = new Map<string, IHealthCheck>();

  /** Registers (or replaces) a check by its name. */
  public register(check: IHealthCheck): void {
    this.checks.set(check.name, check);
  }

  /** Whether a check with the given name is registered. */
  public has(name: string): boolean {
    return this.checks.has(name);
  }

  /** Number of registered checks. */
  public get size(): number {
    return this.checks.size;
  }

  /**
   * Runs every registered check concurrently, each behind a `timeoutMs` guard,
   * and aggregates the results. A check that rejects or times out is reported
   * as `down` (timeout detail `"timeout after <ms>ms"`). Overall status is
   * `ready` only when every CRITICAL check is `up`; non-critical `down` checks
   * are reported but do not fail readiness.
   *
   * With no checks registered the report is trivially `ready` with an empty
   * `checks` map.
   */
  public async runAll(
    timeoutMs: number = DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  ): Promise<HealthReport> {
    const entries = [...this.checks.values()];

    const results = await Promise.all(
      entries.map(async (check) => {
        const result = await withTimeout(
          check.check().catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : 'check failed';
            return { status: 'down', detail } satisfies HealthCheckResult;
          }),
          timeoutMs,
          () => ({ status: 'down', detail: `timeout after ${timeoutMs}ms` }) satisfies HealthCheckResult,
        );
        return { check, result };
      }),
    );

    const checks: Record<string, HealthStatus> = {};
    const details: Record<string, string> = {};
    let healthy = true;

    for (const { check, result } of results) {
      checks[check.name] = result.status;
      if (result.detail !== undefined) {
        details[check.name] = result.detail;
      }
      if (check.critical && result.status === 'down') {
        healthy = false;
      }
    }

    const report: HealthReport = {
      status: healthy ? 'ready' : 'not_ready',
      checks,
    };
    if (Object.keys(details).length > 0) {
      report.details = details;
    }
    return report;
  }
}
