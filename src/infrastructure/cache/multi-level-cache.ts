import type { ICache } from '@application/ports/cache.js';
import type { CacheLogger } from './redis-cache.js';

/**
 * Tiered (L1-over-L2) {@link ICache} implementation for the multi-level caching
 * strategy (task 39.2, Requirement 31.4).
 *
 * Composes two caches into a single {@link ICache} the rest of the platform
 * consumes transparently:
 *
 * - **L1 — near cache.** A small, short-TTL, per-instance in-process cache
 *   (typically an {@link InMemoryCache}) for the very hottest keys. Reads that
 *   hit L1 never touch the network, so frequently accessed data (tenant
 *   branding/configuration) is served in microseconds.
 * - **L2 — shared cache.** A distributed cache (typically a {@link RedisCache})
 *   shared across every horizontally-scaled backend instance
 *   (Requirement 31.2). It is the source of truth for cached data and is what
 *   makes an L1 miss on one instance benefit from a write made by another.
 *
 * **Read path (`get`).** L1 is checked first; on a hit its value is returned
 * without touching L2. On an L1 miss, L2 is checked; on an L2 hit the value is
 * *promoted* into L1 (with the short L1 TTL) so subsequent reads on this
 * instance are served locally, then returned. When both tiers miss, `null` is
 * returned.
 *
 * **Write path (`set`).** Writes go through to BOTH tiers: L2 with the caller's
 * TTL (the shared, authoritative copy) and L1 with a bounded TTL — the smaller
 * of the configured L1 TTL and the caller's TTL — so a near-cache entry never
 * outlives its shared counterpart.
 *
 * **Invalidation (`del`).** Deletes from BOTH tiers so a stale value cannot be
 * served locally or shared after an update.
 *
 * **Bounded L1.** L1 must never grow unbounded, so this cache tracks the keys it
 * has placed in L1 in least-recently-used order and evicts the oldest (via
 * `l1.del`) once the configured maximum is exceeded. Every access path
 * (`get` hit, `set`, promotion) marks the key most-recently-used.
 *
 * **Never throws — graceful degradation.** Every tier operation is guarded: a
 * failing tier is logged and treated as a miss (`get`) or a no-op (`set`/`del`),
 * so a Redis (L2) outage degrades the platform to an L1-only cache and an L1
 * fault degrades to L2-only — requests still succeed. This preserves the
 * {@link ICache} never-throws contract established by {@link RedisCache}. (The
 * underlying {@link RedisCache} already degrades internally; the extra guard
 * here also covers an arbitrary injected tier and keeps the tiers independent.)
 *
 * **Consistency model — eventually consistent L1.** {@link del}/{@link set}
 * update this instance's L1 and the shared L2 synchronously, but they cannot
 * reach the L1 of OTHER instances. A peer instance therefore keeps serving its
 * own (now-stale) L1 copy until that entry's short L1 TTL elapses — so
 * cross-instance staleness is BOUNDED by {@link MultiLevelCacheOptions.l1TtlSeconds}
 * (kept well under the 30-second invalidation budget of Requirement 31.4). A
 * Redis pub/sub broadcast that actively evicts peer L1 entries on write is a
 * documented FUTURE enhancement; it is intentionally not implemented here (no
 * Redis in this environment), and the bounded L1 TTL already satisfies the
 * requirement.
 *
 * **Degenerate case — two in-memory tiers.** When `REDIS_URL` is absent, L2 is
 * itself an {@link InMemoryCache}, so this becomes an in-process cache layered
 * over another in-process cache. That is harmless: it behaves like a single
 * cache (with the extra bookkeeping of the L1 TTL/eviction) and keeps the
 * composition identical whether or not Redis is configured.
 */

/** Default L1 (near-cache) time-to-live: 30 seconds — bounds cross-instance staleness. */
export const DEFAULT_L1_TTL_SECONDS = 30;

/** Default maximum number of entries held in L1 before LRU eviction kicks in. */
export const DEFAULT_MAX_L1_ENTRIES = 1000;

/** Options for constructing a {@link MultiLevelCache}. */
export interface MultiLevelCacheOptions {
  /** The near (L1) cache — small, short-TTL, per-instance (e.g. {@link InMemoryCache}). */
  l1: ICache;
  /** The shared (L2) cache — distributed across instances (e.g. {@link RedisCache}). */
  l2: ICache;
  /**
   * Time-to-live (seconds) applied to L1 entries. Kept short so cross-instance
   * staleness after an invalidation is bounded. Defaults to
   * {@link DEFAULT_L1_TTL_SECONDS}.
   */
  l1TtlSeconds?: number;
  /**
   * Maximum number of keys retained in L1; the least-recently-used key is
   * evicted once this is exceeded. Defaults to {@link DEFAULT_MAX_L1_ENTRIES}.
   */
  maxL1Entries?: number;
  /** Structured logger for the degradation warnings. */
  logger?: CacheLogger;
}

/**
 * {@link ICache} backed by an L1 near-cache over an L2 shared cache. See the
 * module doc-comment for the full contract (read/write/invalidation paths,
 * bounded L1, never-throws degradation and the eventual-consistency model).
 */
export class MultiLevelCache implements ICache {
  private readonly l1: ICache;
  private readonly l2: ICache;
  private readonly l1TtlSeconds: number;
  private readonly maxL1Entries: number;
  private readonly logger: CacheLogger;
  /**
   * Keys currently held in L1, in least-recently-used order (oldest first). A
   * `Map` preserves insertion order; re-inserting a key moves it to the end
   * (most-recently-used). Bookkeeping only — the values live in `l1`.
   */
  private readonly l1Keys = new Map<string, true>();

  constructor(options: MultiLevelCacheOptions) {
    this.l1 = options.l1;
    this.l2 = options.l2;
    this.l1TtlSeconds =
      options.l1TtlSeconds !== undefined && options.l1TtlSeconds > 0
        ? options.l1TtlSeconds
        : DEFAULT_L1_TTL_SECONDS;
    this.maxL1Entries =
      options.maxL1Entries !== undefined && options.maxL1Entries > 0
        ? options.maxL1Entries
        : DEFAULT_MAX_L1_ENTRIES;
    this.logger = options.logger ?? defaultMultiLevelLogger;
  }

  async get<T>(key: string): Promise<T | null> {
    // L1 first — a near-cache hit never touches L2.
    const l1Hit = await this.safe('get', key, () => this.l1.get<T>(key));
    if (l1Hit !== null) {
      this.markRecentlyUsed(key);
      return l1Hit;
    }

    // L1 miss → consult the shared L2 tier.
    const l2Hit = await this.safe('get', key, () => this.l2.get<T>(key));
    if (l2Hit !== null) {
      // Promote into L1 so subsequent local reads are served without the network.
      await this.populateL1(key, l2Hit, this.l1TtlSeconds);
      return l2Hit;
    }

    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Write through to the shared tier with the caller's TTL (authoritative copy)...
    await this.safe('set', key, () => this.l2.set(key, value, ttlSeconds));
    // ...and to the near tier with a bounded TTL that never outlives L2's.
    await this.populateL1(key, value, this.boundedL1Ttl(ttlSeconds));
  }

  async del(key: string): Promise<void> {
    // Invalidate BOTH tiers so no instance can serve or share a stale value.
    await this.safe('del', key, () => this.l1.del(key));
    this.l1Keys.delete(key);
    await this.safe('del', key, () => this.l2.del(key));
  }

  /**
   * Writes `value` into L1 under `key` with `ttlSeconds`, records the key as
   * most-recently-used and evicts the least-recently-used key(s) when the size
   * bound is exceeded. Never throws.
   */
  private async populateL1<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.safe('set', key, () => this.l1.set(key, value, ttlSeconds));
    this.markRecentlyUsed(key);
    await this.evictIfNeeded();
  }

  /** Moves `key` to the most-recently-used position in the L1 tracking map. */
  private markRecentlyUsed(key: string): void {
    // Delete + re-insert so the key becomes the newest entry (Map keeps order).
    this.l1Keys.delete(key);
    this.l1Keys.set(key, true);
  }

  /** Evicts least-recently-used L1 entries until the size bound is satisfied. */
  private async evictIfNeeded(): Promise<void> {
    while (this.l1Keys.size > this.maxL1Entries) {
      // The first key in insertion order is the least-recently-used one.
      const oldest = this.l1Keys.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.l1Keys.delete(oldest);
      await this.safe('del', oldest, () => this.l1.del(oldest));
    }
  }

  /**
   * Computes the L1 TTL for a write: the smaller of the configured L1 TTL and
   * the caller's TTL (when a positive one is supplied), so a near-cache entry
   * never lives longer than its shared counterpart.
   */
  private boundedL1Ttl(callerTtlSeconds?: number): number {
    if (callerTtlSeconds !== undefined && callerTtlSeconds > 0) {
      return Math.min(this.l1TtlSeconds, callerTtlSeconds);
    }
    return this.l1TtlSeconds;
  }

  /**
   * Runs a tier operation, degrading a thrown error to a warning + safe default
   * (`null` for reads, `undefined` for writes/deletes) so this cache never
   * throws. The underlying {@link RedisCache} already degrades internally; this
   * guard additionally protects against an arbitrary injected tier.
   */
  private async safe<R>(
    op: 'get' | 'set' | 'del',
    key: string,
    action: () => Promise<R>,
  ): Promise<R | null> {
    try {
      return await action();
    } catch (error) {
      this.logger.warn(
        { cache: 'multi-level', op, key, error: errorMessage(error) },
        'Multi-level cache tier operation failed; degrading gracefully',
      );
      return null;
    }
  }
}

/** Fallback logger used before the application's pino logger is injected. */
const defaultMultiLevelLogger: CacheLogger = {
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
