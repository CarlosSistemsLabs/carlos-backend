import type { ICache } from '@application/ports/cache.js';

/** Internal cache slot: the stored value plus its absolute expiry (ms epoch). */
interface CacheEntry {
  value: unknown;
  /** Absolute expiry timestamp (ms), or `null` when the entry never expires. */
  expiresAt: number | null;
}

/**
 * In-process {@link ICache} implementation backed by a `Map` with lazy TTL
 * expiry.
 *
 * This is the default cache binding until the Redis-backed implementation is
 * wired in task 39.1 (which will satisfy the SAME {@link ICache} port, so no
 * consumer changes are needed). It is intentionally simple: entries carry an
 * optional absolute expiry that is checked lazily on read (and opportunistically
 * cleared) so no background timers are required. Suitable for a single process;
 * it does NOT propagate across instances — that cross-instance guarantee is
 * exactly what the Redis implementation adds later.
 *
 * An injectable `now` clock keeps TTL behaviour deterministic under test.
 */
export class InMemoryCache implements ICache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return Promise.resolve(null);
    }
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      // Lazily evict the expired entry so it is not served and does not linger.
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value as T);
  }

  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds !== undefined && ttlSeconds > 0 ? this.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}
