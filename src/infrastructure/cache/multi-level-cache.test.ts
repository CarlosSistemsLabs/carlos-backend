import { describe, it, expect, vi } from 'vitest';
import type { ICache } from '@application/ports/cache.js';
import { InMemoryCache } from './in-memory-cache.js';
import { MultiLevelCache } from './multi-level-cache.js';
import type { CacheLogger } from './redis-cache.js';

/** A silent logger so degradation tests do not spam the console. */
function silentLogger(): CacheLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

/** An {@link ICache} that counts calls and delegates to an inner cache. */
class CountingCache implements ICache {
  public gets = 0;
  public sets = 0;
  public dels = 0;
  constructor(private readonly inner: ICache = new InMemoryCache()) {}

  get<T>(key: string): Promise<T | null> {
    this.gets += 1;
    return this.inner.get<T>(key);
  }
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.sets += 1;
    return this.inner.set(key, value, ttlSeconds);
  }
  del(key: string): Promise<void> {
    this.dels += 1;
    return this.inner.del(key);
  }
}

/** An {@link ICache} whose every operation rejects — simulates an L2 outage. */
class ThrowingCache implements ICache {
  get(): Promise<null> {
    return Promise.reject(new Error('tier down'));
  }
  set(): Promise<void> {
    return Promise.reject(new Error('tier down'));
  }
  del(): Promise<void> {
    return Promise.reject(new Error('tier down'));
  }
}

describe('MultiLevelCache', () => {
  it('returns null when both tiers miss', async () => {
    const cache = new MultiLevelCache({ l1: new InMemoryCache(), l2: new InMemoryCache() });
    expect(await cache.get('missing')).toBeNull();
  });

  it('serves an L1 hit without touching L2', async () => {
    const l2 = new CountingCache();
    const cache = new MultiLevelCache({ l1: new InMemoryCache(), l2 });

    await cache.set('k', 'v'); // writes through to both (1 L2 set)
    l2.gets = 0; // reset read counter

    expect(await cache.get('k')).toBe('v');
    // L1 satisfied the read; L2 was never consulted.
    expect(l2.gets).toBe(0);
  });

  it('promotes an L2 hit into L1 (subsequent reads skip L2)', async () => {
    const l2Inner = new InMemoryCache();
    const l2 = new CountingCache(l2Inner);
    const cache = new MultiLevelCache({ l1: new InMemoryCache(), l2 });

    // Seed ONLY L2 (bypassing the multi-level write path).
    await l2Inner.set('k', 'shared');
    l2.gets = 0;

    // First read misses L1, hits L2 (1 L2 get) and promotes into L1.
    expect(await cache.get('k')).toBe('shared');
    expect(l2.gets).toBe(1);

    // Second read is now served from L1 — no further L2 reads.
    expect(await cache.get('k')).toBe('shared');
    expect(l2.gets).toBe(1);
  });

  it('writes through to BOTH tiers on set', async () => {
    const l1 = new InMemoryCache();
    const l2 = new InMemoryCache();
    const cache = new MultiLevelCache({ l1, l2 });

    await cache.set('k', { a: 1 });

    expect(await l1.get('k')).toEqual({ a: 1 });
    expect(await l2.get('k')).toEqual({ a: 1 });
  });

  it('invalidates BOTH tiers on del', async () => {
    const l1 = new InMemoryCache();
    const l2 = new InMemoryCache();
    const cache = new MultiLevelCache({ l1, l2 });

    await cache.set('k', 'v');
    await cache.del('k');

    expect(await l1.get('k')).toBeNull();
    expect(await l2.get('k')).toBeNull();
  });

  it('passes the caller TTL through to L2', async () => {
    const l2 = new CountingCache();
    const setSpy = vi.spyOn(l2, 'set');
    const cache = new MultiLevelCache({ l1: new InMemoryCache(), l2, l1TtlSeconds: 30 });

    await cache.set('k', 'v', 600);
    expect(setSpy).toHaveBeenCalledWith('k', 'v', 600);
  });

  describe('bounded L1 (LRU eviction)', () => {
    it('evicts the least-recently-used key from L1 but keeps it in L2', async () => {
      const l1 = new InMemoryCache();
      const l2 = new InMemoryCache();
      const cache = new MultiLevelCache({ l1, l2, maxL1Entries: 2 });

      await cache.set('a', 1);
      await cache.set('b', 2);
      await cache.set('c', 3); // exceeds max → 'a' (LRU) evicted from L1

      // 'a' is gone from L1 but still present in the shared L2.
      expect(await l1.get('a')).toBeNull();
      expect(await l2.get('a')).toBe(1);
      // 'b' and 'c' remain in L1.
      expect(await l1.get('b')).toBe(2);
      expect(await l1.get('c')).toBe(3);
    });

    it('a read refreshes recency so the untouched key is evicted', async () => {
      const l1 = new InMemoryCache();
      const l2 = new InMemoryCache();
      const cache = new MultiLevelCache({ l1, l2, maxL1Entries: 2 });

      await cache.set('a', 1);
      await cache.set('b', 2);
      await cache.get('a'); // 'a' becomes most-recently-used
      await cache.set('c', 3); // now 'b' is the LRU → evicted from L1

      expect(await l1.get('b')).toBeNull();
      expect(await l1.get('a')).toBe(1);
      expect(await l1.get('c')).toBe(3);
    });
  });

  describe('L1 TTL bounds staleness', () => {
    it('caps the L1 TTL at the configured bound even when the caller asks for more', async () => {
      let now = 0;
      const l1 = new InMemoryCache(() => now);
      const l2 = new InMemoryCache(() => now);
      const cache = new MultiLevelCache({ l1, l2, l1TtlSeconds: 30 });

      // Caller wants a 1-hour TTL; L1 must still expire after 30s.
      await cache.set('k', 'v', 3600);

      now += 31_000; // past the 30s L1 bound, well within the 1h L2 TTL

      // L1 entry has expired...
      expect(await l1.get('k')).toBeNull();
      // ...but the shared L2 copy is still valid, so the tiered read succeeds
      // (and re-promotes into L1).
      expect(await cache.get('k')).toBe('v');
    });
  });

  describe('graceful degradation (never throws)', () => {
    it('degrades to L1-only writes when L2 throws', async () => {
      const l1 = new InMemoryCache();
      const cache = new MultiLevelCache({ l1, l2: new ThrowingCache(), logger: silentLogger() });

      await expect(cache.set('k', 'v')).resolves.toBeUndefined();
      // The value is still readable from L1 despite L2 being down.
      expect(await cache.get('k')).toBe('v');
    });

    it('returns null (not a throw) when L1 misses and L2 throws', async () => {
      const cache = new MultiLevelCache({
        l1: new InMemoryCache(),
        l2: new ThrowingCache(),
        logger: silentLogger(),
      });

      await expect(cache.get('nope')).resolves.toBeNull();
    });

    it('never throws from del when a tier throws', async () => {
      const cache = new MultiLevelCache({
        l1: new InMemoryCache(),
        l2: new ThrowingCache(),
        logger: silentLogger(),
      });

      await expect(cache.del('k')).resolves.toBeUndefined();
    });
  });
});
