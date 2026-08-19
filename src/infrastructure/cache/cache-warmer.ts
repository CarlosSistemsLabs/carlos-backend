import type { ICache } from '@application/ports/cache.js';
import type { CacheLogger } from './redis-cache.js';

/**
 * Cache warming for tenant configurations (task 39.2, Requirement 31.4).
 *
 * "Warming" pre-loads frequently accessed, slow-changing data — chiefly a
 * tenant's configuration and branding — into the cache BEFORE the first request
 * needs it, so the initial read after a deploy / cold start is served from cache
 * rather than paying a database round-trip (and every instance's L1 gets a head
 * start). It is the proactive counterpart to the lazy cache-aside reads.
 *
 * The warmer is deliberately decoupled from any feature module: each thing to
 * warm is expressed as a {@link CacheWarmLoader} (a name, a key builder, a value
 * loader and an optional TTL) supplied at construction. The composition root
 * wires loaders backed by the Administration configuration/branding
 * repositories through their ports, so this module stays free of module
 * imports and is trivially testable with fakes.
 *
 * **Never throws — safe to call at boot.** Warming is a best-effort
 * optimisation, never a correctness requirement: a loader that throws (e.g. the
 * database is briefly unavailable) or returns `null`/empty (nothing to warm) is
 * logged and skipped, and the warmer moves on to the next loader/tenant. A
 * failed warm simply means the value is fetched lazily on first access, so boot
 * is never blocked or crashed by warming.
 */

/**
 * A single unit of warmable data: how to build its cache key for a tenant and
 * how to load the value to cache. Kept abstract so the warmer does not depend on
 * any repository/use-case type.
 */
export interface CacheWarmLoader {
  /** Human-readable name for logging (e.g. `tenant-configurations`). */
  readonly name: string;
  /** Builds the cache key this loader populates for `tenantId`. */
  key(tenantId: string): string;
  /**
   * Loads the value to cache for `tenantId`. Return `null` (or throw) when there
   * is nothing to warm; the warmer treats both as "skip" and never caches
   * `null`.
   */
  load(tenantId: string): Promise<unknown>;
  /** Optional TTL (seconds) for the warmed entry; omitted → no expiry. */
  readonly ttlSeconds?: number;
}

/** Options for constructing a {@link CacheWarmer}. */
export interface CacheWarmerOptions {
  /** The cache to populate (typically the {@link MultiLevelCache}). */
  cache: ICache;
  /** The set of warmable data definitions to run for each tenant. */
  loaders: readonly CacheWarmLoader[];
  /** Structured logger for warm/skip lines. */
  logger?: CacheLogger;
}

/**
 * Pre-loads tenant data into the cache via injected {@link CacheWarmLoader}s.
 * Every method is best-effort and never throws (see the module doc-comment).
 */
export class CacheWarmer {
  private readonly cache: ICache;
  private readonly loaders: readonly CacheWarmLoader[];
  private readonly logger: CacheLogger;

  constructor(options: CacheWarmerOptions) {
    this.cache = options.cache;
    this.loaders = options.loaders;
    this.logger = options.logger ?? defaultWarmerLogger;
  }

  /**
   * Warms every configured loader for a single tenant. Continues past any loader
   * that throws or has nothing to warm. Returns the number of entries actually
   * cached (useful for logging/tests).
   */
  async warmTenant(tenantId: string): Promise<number> {
    let warmed = 0;
    for (const loader of this.loaders) {
      if (await this.runLoader(loader, tenantId)) {
        warmed += 1;
      }
    }
    return warmed;
  }

  /**
   * Warms every configured loader for each supplied tenant. Safe to call at boot
   * for the set of known tenants, or on demand for a single tenant. Returns the
   * total number of entries cached across all tenants.
   */
  async warmTenants(tenantIds: readonly string[]): Promise<number> {
    let warmed = 0;
    for (const tenantId of tenantIds) {
      warmed += await this.warmTenant(tenantId);
    }
    return warmed;
  }

  /**
   * Runs one loader for one tenant: loads the value, and — when a non-null value
   * is produced — writes it to the cache under the loader's key. Returns whether
   * an entry was cached. Swallows all errors (best-effort warming).
   */
  private async runLoader(loader: CacheWarmLoader, tenantId: string): Promise<boolean> {
    try {
      const value = await loader.load(tenantId);
      if (value === null || value === undefined) {
        // Nothing to warm — a valid, common case (e.g. a tenant with no config).
        return false;
      }
      await this.cache.set(
        loader.key(tenantId),
        value,
        ...(loader.ttlSeconds !== undefined ? ([loader.ttlSeconds] as const) : ([] as const)),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        { cache: 'warmer', loader: loader.name, tenantId, error: errorMessage(error) },
        'Cache warm failed; value will be loaded lazily on first access',
      );
      return false;
    }
  }
}

/** Fallback logger used before the application's pino logger is injected. */
const defaultWarmerLogger: CacheLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- boot-time fallback before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
};

/** Extracts a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
