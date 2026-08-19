import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICache } from '@application/ports/cache.js';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { cacheAside, queryFingerprint, VersionedListCache } from './query-cache.js';

/** A cache whose every operation throws — used to prove graceful degradation. */
class ThrowingCache implements ICache {
  get<T>(_key: string): Promise<T | null> {
    return Promise.reject(new Error('cache down'));
  }
  set<T>(_key: string, _value: T, _ttl?: number): Promise<void> {
    return Promise.reject(new Error('cache down'));
  }
  del(_key: string): Promise<void> {
    return Promise.reject(new Error('cache down'));
  }
}

describe('queryFingerprint', () => {
  it('is independent of parameter declaration order', () => {
    const a = queryFingerprint({ page: 1, pageSize: 20, isActive: true });
    const b = queryFingerprint({ isActive: true, pageSize: 20, page: 1 });
    expect(a).toBe(b);
  });

  it('omits undefined values so an absent filter does not change the key', () => {
    expect(queryFingerprint({ page: 1, isActive: undefined })).toBe(queryFingerprint({ page: 1 }));
  });

  it('distinguishes different queries', () => {
    expect(queryFingerprint({ page: 1 })).not.toBe(queryFingerprint({ page: 2 }));
    expect(queryFingerprint({ isActive: true })).not.toBe(queryFingerprint({ isActive: false }));
  });

  it('URL-encodes values so delimiters cannot forge a different param set', () => {
    // A term containing '&' and '=' must not be mistaken for extra params.
    const fp = queryFingerprint({ term: 'a&b=c' });
    expect(fp).toBe('term=a%26b%3Dc');
  });
});

describe('cacheAside', () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache();
  });

  it('returns the cached value without invoking the loader on a hit', async () => {
    await cache.set('k', 'cached');
    const load = vi.fn(async () => 'fresh');

    const result = await cacheAside(cache, 'k', 60, load);

    expect(result).toBe('cached');
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and populates the cache on a miss', async () => {
    const load = vi.fn(async () => 'fresh');

    const result = await cacheAside(cache, 'k', 60, load);

    expect(result).toBe('fresh');
    expect(load).toHaveBeenCalledOnce();
    expect(await cache.get('k')).toBe('fresh');
  });

  it('honours the TTL when populating', async () => {
    let now = 1000;
    cache = new InMemoryCache(() => now);
    const load = vi.fn(async () => 'fresh');

    await cacheAside(cache, 'k', 30, load);
    now += 31_000;

    expect(await cache.get('k')).toBeNull();
  });

  it('does not cache when the loader throws (errors are never cached)', async () => {
    const load = vi.fn(async () => {
      throw new Error('not found');
    });

    await expect(cacheAside(cache, 'k', 60, load)).rejects.toThrow('not found');
    expect(await cache.get('k')).toBeNull();
  });

  it('degrades to the loader when the cache throws', async () => {
    const load = vi.fn(async () => 'fresh');
    const result = await cacheAside(new ThrowingCache(), 'k', 60, load);
    expect(result).toBe('fresh');
    expect(load).toHaveBeenCalledOnce();
  });
});

describe('VersionedListCache', () => {
  let cache: InMemoryCache;
  let listCache: VersionedListCache;

  beforeEach(() => {
    cache = new InMemoryCache();
    listCache = new VersionedListCache(cache, 'product-list', 60);
  });

  it('loads on a miss and serves subsequent identical queries from cache', async () => {
    const load = vi.fn(async () => ['a', 'b']);

    const first = await listCache.read('t1', 'page=1', load);
    const second = await listCache.read('t1', 'page=1', load);

    expect(first).toEqual(['a', 'b']);
    expect(second).toEqual(['a', 'b']);
    expect(load).toHaveBeenCalledOnce();
  });

  it('caches different fingerprints independently', async () => {
    const load = vi.fn(async (fp: string) => [fp]);

    await listCache.read('t1', 'page=1', () => load('page=1'));
    await listCache.read('t1', 'page=2', () => load('page=2'));

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('isolates tenants (one tenant never reads another tenant cache)', async () => {
    await listCache.read('t1', 'page=1', async () => ['t1-data']);
    const other = await listCache.read('t2', 'page=1', async () => ['t2-data']);
    expect(other).toEqual(['t2-data']);
  });

  it('honours the TTL when populating an entry', async () => {
    let now = 1000;
    cache = new InMemoryCache(() => now);
    listCache = new VersionedListCache(cache, 'product-list', 30);
    const load = vi.fn(async () => ['x']);

    await listCache.read('t1', 'page=1', load);
    now += 31_000;
    await listCache.read('t1', 'page=1', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidate() bumps the version so the next read is a miss', async () => {
    const load = vi.fn(async () => ['a']);

    await listCache.read('t1', 'page=1', load); // miss → populate v0
    await listCache.read('t1', 'page=1', load); // hit v0
    await listCache.invalidate('t1'); // bump → v1
    await listCache.read('t1', 'page=1', load); // miss again → v1

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidate() clears every cached permutation at once', async () => {
    const load = vi.fn(async (fp: string) => [fp]);

    await listCache.read('t1', 'page=1', () => load('page=1'));
    await listCache.read('t1', 'page=2', () => load('page=2'));
    expect(load).toHaveBeenCalledTimes(2);

    await listCache.invalidate('t1');

    await listCache.read('t1', 'page=1', () => load('page=1'));
    await listCache.read('t1', 'page=2', () => load('page=2'));
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('degrades to the loader when the cache throws', async () => {
    const throwingListCache = new VersionedListCache(new ThrowingCache(), 'product-list', 60);
    const load = vi.fn(async () => ['fresh']);

    const result = await throwingListCache.read('t1', 'page=1', load);

    expect(result).toEqual(['fresh']);
    expect(load).toHaveBeenCalledOnce();
  });

  it('does not throw when invalidate cannot reach the cache', async () => {
    const throwingListCache = new VersionedListCache(new ThrowingCache(), 'product-list', 60);
    await expect(throwingListCache.invalidate('t1')).resolves.toBeUndefined();
  });
});
