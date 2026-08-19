import type { ICache } from '@application/ports/cache.js';

/**
 * Query-result caching helpers for the read-heavy list/search/configuration use
 * cases (task 39.4, Requirement 26.1).
 *
 * These helpers implement the two halves of a cache-aside strategy on top of the
 * framework-agnostic {@link ICache} port:
 *
 * 1. {@link cacheAside} — a simple read-through for a SINGLE, stable key (used by
 *    the configuration reads, whose key is just `tenant-config:<tenantId>[:key]`).
 * 2. {@link VersionedListCache} — a read-through + invalidation strategy for
 *    PAGINATED/FILTERED list results, whose cache key embeds the query
 *    parameters and therefore cannot be enumerated for invalidation (see the
 *    class doc-comment).
 *
 * **Graceful degradation.** Both helpers treat the cache as best-effort: a miss
 * (or any error from a misbehaving cache implementation) simply falls through to
 * the supplied loader so the request still succeeds with correct data from the
 * source of truth. The production {@link ICache} implementations already never
 * throw; the defensive `try/catch` here additionally protects against an
 * arbitrary injected cache and keeps the never-throws guarantee at the call
 * site.
 *
 * **Tenant isolation.** Every key produced here is tenant-scoped (the `tenantId`
 * is the first structural segment), so one tenant can never read another
 * tenant's cached results.
 */

/** A primitive query-parameter value that can appear in a cache-key fingerprint. */
export type FingerprintValue = string | number | boolean | null | undefined;

/**
 * Builds a STABLE, deterministic fingerprint of a bag of query parameters,
 * suitable for embedding in a cache key.
 *
 * The fingerprint is what makes two list requests with the SAME effective query
 * share a cache entry while requests with DIFFERENT queries stay separate:
 *
 * - `undefined` values are omitted — an absent filter must not change the key
 *   (so `{ page: 1 }` and `{ page: 1, isActive: undefined }` collide, as they
 *   describe the same query);
 * - keys are sorted so parameter declaration order never affects the result;
 * - values are URL-encoded so a value containing the `=`/`&`/`:` delimiters
 *   cannot forge a different parameter set.
 *
 * Note `null` is encoded as the literal string `null`; callers that need to
 * distinguish "filter absent" from "filter explicitly null" should pass
 * `undefined` for the former (the common case).
 */
export function queryFingerprint(params: Record<string, FingerprintValue>): string {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

/**
 * Read-through cache-aside for a single, stable key.
 *
 * On a hit the cached value is returned WITHOUT invoking `load`. On a miss (or
 * any cache error) `load` is called, its result cached under `key` with
 * `ttlSeconds`, and returned. If `load` throws (e.g. a not-found), nothing is
 * cached and the error propagates — so error responses are never cached.
 *
 * @param cache - The cache to read/populate.
 * @param key - The tenant-scoped cache key.
 * @param ttlSeconds - Time-to-live applied when populating the entry.
 * @param load - Loads the value from the source of truth on a miss.
 */
export async function cacheAside<T>(
  cache: ICache,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await cache.get<T>(key);
    if (cached !== null) {
      return cached;
    }
  } catch {
    // Degrade to a direct load; a cache read fault must never fail the request.
  }

  const result = await load();

  try {
    await cache.set(key, result, ttlSeconds);
  } catch {
    // A cache write fault is non-fatal — the correct result is already in hand.
  }

  return result;
}

/**
 * Version-based cache-aside for paginated/filtered LIST results (task 39.4).
 *
 * **The problem.** A product/customer list key must embed the query parameters
 * (page, page size, filters, sort, search term) so different queries do not
 * clobber each other — e.g.
 * `product-list:<tenantId>:v<version>:page=1&pageSize=20&sortBy=name`. But that
 * makes the set of live keys for a tenant UNBOUNDED and unknowable, so a
 * mutation (create/update/delete) cannot enumerate and delete every affected
 * permutation.
 *
 * **The strategy — a per-tenant version counter.** Each tenant has a version
 * number stored in the cache (`<namespace>-version:<tenantId>`, default `0`).
 * Every list key embeds the CURRENT version (`...:v<version>:...`). A mutation
 * simply BUMPS the version (`del`-free, a single `set`), which changes the
 * prefix every future read computes — so all previously-cached permutations are
 * instantly orphaned and the next read of any query is a guaranteed miss that
 * re-populates under the new version. The orphaned entries are never read again
 * and fall out of the cache when their {@link ICache} TTL elapses (or are
 * evicted under memory pressure). This gives O(1) invalidation of an entire
 * tenant's list namespace without tracking individual keys.
 *
 * **Bounded staleness / never-throws.** All cache interactions are best-effort:
 * a fault reading the version or an entry degrades to a direct `load` (and skips
 * caching), and a failed version bump leaves the old version in place — in which
 * case staleness is bounded by the entry TTL, never indefinite. The request
 * always returns correct data from the loader.
 *
 * **Version storage.** The version counter is stored WITHOUT a TTL so it is not
 * spuriously reset. In the unlikely event it is evicted, it resets to `0`; any
 * still-cached higher-version entries simply become unreachable and expire — a
 * safe (never stale-serving) outcome. A reset to a version whose entries are
 * still cached is likewise bounded by the short list TTL.
 */
export class VersionedListCache {
  /**
   * @param cache - The cache backing this namespace.
   * @param namespace - Stable prefix identifying the cached collection
   *   (e.g. `product-list`); shared by the read and invalidation call sites.
   * @param ttlSeconds - Time-to-live applied to each cached list page.
   */
  constructor(
    private readonly cache: ICache,
    private readonly namespace: string,
    private readonly ttlSeconds: number,
  ) {}

  /**
   * Returns the cached result for `(tenantId, fingerprint)` at the current
   * version, or populates it from `load` on a miss. See the class doc-comment
   * for the version/invalidation contract and graceful-degradation behaviour.
   *
   * @param tenantId - The owning tenant (keeps entries tenant-isolated).
   * @param fingerprint - Stable fingerprint of the query (see {@link queryFingerprint}).
   * @param load - Loads the result from the source of truth on a miss.
   */
  async read<T>(tenantId: string, fingerprint: string, load: () => Promise<T>): Promise<T> {
    let entryKey: string | null = null;
    try {
      const version = await this.currentVersion(tenantId);
      entryKey = this.entryKey(tenantId, version, fingerprint);
      const cached = await this.cache.get<T>(entryKey);
      if (cached !== null) {
        return cached;
      }
    } catch {
      // Cache unavailable — skip caching entirely and load directly.
      entryKey = null;
    }

    const result = await load();

    if (entryKey !== null) {
      try {
        await this.cache.set(entryKey, result, this.ttlSeconds);
      } catch {
        // Non-fatal: the correct result is already in hand.
      }
    }

    return result;
  }

  /**
   * Invalidates every cached list page for `tenantId` by bumping the tenant's
   * version counter. O(1) regardless of how many query permutations are cached.
   * Never throws — a failure leaves the previous version (staleness then bounded
   * by the entry TTL).
   */
  async invalidate(tenantId: string): Promise<void> {
    try {
      const version = await this.currentVersion(tenantId);
      await this.cache.set(this.versionKey(tenantId), version + 1);
    } catch {
      // Best-effort: TTL expiry is the fallback if the bump does not land.
    }
  }

  /** Reads the tenant's current list version, defaulting to `0` when unset. */
  private async currentVersion(tenantId: string): Promise<number> {
    const stored = await this.cache.get<number>(this.versionKey(tenantId));
    return typeof stored === 'number' && Number.isFinite(stored) && stored >= 0 ? stored : 0;
  }

  /** Key holding the tenant's list version (`<namespace>-version:<tenantId>`). */
  private versionKey(tenantId: string): string {
    return `${this.namespace}-version:${tenantId}`;
  }

  /**
   * Key for a single cached list page
   * (`<namespace>:<tenantId>:v<version>:<fingerprint>`).
   */
  private entryKey(tenantId: string, version: number, fingerprint: string): string {
    return `${this.namespace}:${tenantId}:v${version}:${fingerprint}`;
  }
}
