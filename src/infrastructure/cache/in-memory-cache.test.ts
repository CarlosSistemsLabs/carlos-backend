import { describe, it, expect } from 'vitest';
import { InMemoryCache } from './in-memory-cache.js';

describe('InMemoryCache', () => {
  it('returns null for a missing key', async () => {
    const cache = new InMemoryCache();
    expect(await cache.get('missing')).toBeNull();
  });

  it('stores and retrieves a value (round-trip)', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', { hello: 'world' });
    expect(await cache.get<{ hello: string }>('k')).toEqual({ hello: 'world' });
  });

  it('overwrites an existing value', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', 1);
    await cache.set('k', 2);
    expect(await cache.get<number>('k')).toBe(2);
  });

  it('deletes a key', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', 'v');
    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('del on a missing key is a no-op', async () => {
    const cache = new InMemoryCache();
    await expect(cache.del('nope')).resolves.toBeUndefined();
  });

  it('does not expire entries stored without a TTL', async () => {
    let now = 1000;
    const cache = new InMemoryCache(() => now);
    await cache.set('k', 'v');
    now += 10_000_000;
    expect(await cache.get('k')).toBe('v');
  });

  it('serves a TTL entry before it expires', async () => {
    let now = 1000;
    const cache = new InMemoryCache(() => now);
    await cache.set('k', 'v', 60);
    now += 59_000; // 59s < 60s TTL
    expect(await cache.get('k')).toBe('v');
  });

  it('evicts a TTL entry once it has expired', async () => {
    let now = 1000;
    const cache = new InMemoryCache(() => now);
    await cache.set('k', 'v', 60);
    now += 60_001; // just past the 60s TTL
    expect(await cache.get('k')).toBeNull();
    // A second read still returns null (entry was evicted).
    expect(await cache.get('k')).toBeNull();
  });

  it('treats a non-positive TTL as no expiry', async () => {
    let now = 1000;
    const cache = new InMemoryCache(() => now);
    await cache.set('k', 'v', 0);
    now += 10_000_000;
    expect(await cache.get('k')).toBe('v');
  });
});
