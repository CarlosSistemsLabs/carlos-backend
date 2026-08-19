/**
 * Pure, dependency-free helpers for configuring the Prisma client.
 *
 * These functions are intentionally isolated from the environment loader and
 * the generated Prisma client so they can be unit-tested without a database or
 * generated artifacts.
 */

/** Runtime environments supported by the application. */
export type NodeEnvironment = 'development' | 'test' | 'production';

/** Prisma log levels (mirrors `Prisma.LogLevel`). */
export type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

/**
 * Resolves the Prisma log levels for a given runtime environment.
 *
 * - `development` / `test`: verbose logging including raw queries to aid debugging.
 * - `production`: quieter logging limited to informational and warning/error signals.
 */
export function resolvePrismaLogLevels(nodeEnv: NodeEnvironment): PrismaLogLevel[] {
  switch (nodeEnv) {
    case 'production':
      return ['info', 'warn', 'error'];
    case 'development':
    case 'test':
    default:
      return ['query', 'info', 'warn', 'error'];
  }
}

/**
 * Resolved connection-pool configuration (Requirement 31.3, task 39.3).
 *
 * `max` is the hard upper bound Prisma enforces (its `connection_limit`); `min`
 * is the ADVISORY target minimum of warm connections. Prisma does not expose a
 * native minimum — it opens connections lazily up to `max` and reaps idle ones
 * — so `min` is captured here for documentation/observability and as the target
 * for an optional warmup, never faked as a Prisma setting.
 */
export interface PoolConfig {
  /** Advisory minimum of warm connections (not natively enforced by Prisma). */
  min: number;
  /** Hard maximum connections per instance (Prisma `connection_limit`). */
  max: number;
  /** Seconds to wait for a free connection before timing out (Prisma `pool_timeout`). */
  timeoutSeconds: number;
}

/**
 * Normalizes raw pool env values into a coherent {@link PoolConfig}.
 *
 * Guards against nonsensical configuration: `max` is forced to at least `1`, and
 * `min` is clamped to `[0, max]` so an advisory minimum can never exceed the
 * hard maximum. The returned `min` is advisory only (see {@link PoolConfig}).
 */
export function resolvePoolConfig(min: number, max: number, timeoutSeconds: number): PoolConfig {
  const resolvedMax = Math.max(1, Math.floor(max));
  const flooredMin = Math.max(0, Math.floor(min));
  return {
    min: Math.min(flooredMin, resolvedMax),
    max: resolvedMax,
    timeoutSeconds: Math.max(0, Math.floor(timeoutSeconds)),
  };
}

/**
 * Appends connection-pool tuning parameters to a PostgreSQL connection string.
 *
 * Prisma configures its pool exclusively through the datasource URL: `poolSize`
 * becomes the `connection_limit` (the pool's hard maximum) and
 * `poolTimeoutSeconds` becomes `pool_timeout`. There is no URL parameter (nor
 * client API) for a pool MINIMUM — Prisma opens connections lazily up to the
 * limit — so the configured `DATABASE_POOL_MIN` is intentionally not encoded
 * here (it is advisory; see {@link resolvePoolConfig}).
 *
 * Existing `connection_limit` / `pool_timeout` values in the URL are preserved
 * (an operator override always wins). If the URL cannot be parsed, the original
 * string is returned unchanged so the caller (and Prisma) can surface a
 * meaningful validation error rather than this helper masking it.
 */
export function buildDatabaseUrl(
  baseUrl: string,
  poolSize: number,
  poolTimeoutSeconds: number,
): string {
  try {
    const url = new URL(baseUrl);

    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(poolSize));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(poolTimeoutSeconds));
    }

    return url.toString();
  } catch {
    return baseUrl;
  }
}
