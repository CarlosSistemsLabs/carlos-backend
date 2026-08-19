import { describe, it, expect, vi } from 'vitest';
import { InMemoryCache } from './in-memory-cache.js';
import { CacheWarmer, type CacheWarmLoader } from './cache-warmer.js';
import { CacheKeys } from './cache-keys.js';
import type { CacheLogger } from './redis-cache.js';

/** A silent logger so failure tests do not spam the console. */
function silentLogger(): CacheLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('CacheWarmer', () => {
  it('warms a tenant configuration loader into the cache', async () => {
    const cache = new InMemoryCache();
    const configLoader: CacheWarmLoader = {
      name: 'tenant-configurations',
      key: (tenantId) => CacheKeys.tenantConfigurations(tenantId),
      load: async () => [{ key: 'sales.defaultTaxRate', value: 21 }],
    };
    const warmer = new CacheWarmer({ cache, loaders: [configLoader] });

    const count = await warmer.warmTenant('t1');

    expect(count).toBe(1);
    expect(await cache.get(CacheKeys.tenantConfigurations('t1'))).toEqual([
      { key: 'sales.defaultTaxRate', value: 21 },
    ]);
  });

  it('applies a loader TTL when caching the warmed value', async () => {
    const cache = new InMemoryCache();
    const setSpy = vi.spyOn(cache, 'set');
    const loader: CacheWarmLoader = {
      name: 'tenant-branding',
      key: (tenantId) => CacheKeys.branding(tenantId),
      ttlSeconds: 300,
      load: async () => ({ name: 'Acme' }),
    };
    const warmer = new CacheWarmer({ cache, loaders: [loader] });

    await warmer.warmTenant('t1');

    expect(setSpy).toHaveBeenCalledWith('branding:t1', { name: 'Acme' }, 300);
  });

  it('no-ops (skips) when a loader returns null and caches nothing', async () => {
    const cache = new InMemoryCache();
    const setSpy = vi.spyOn(cache, 'set');
    const loader: CacheWarmLoader = {
      name: 'tenant-branding',
      key: (tenantId) => CacheKeys.branding(tenantId),
      load: async () => null, // e.g. tenant not found
    };
    const warmer = new CacheWarmer({ cache, loaders: [loader] });

    const count = await warmer.warmTenant('missing');

    expect(count).toBe(0);
    expect(setSpy).not.toHaveBeenCalled();
    expect(await cache.get(CacheKeys.branding('missing'))).toBeNull();
  });

  it('never throws when a loader throws, and continues with other loaders', async () => {
    const cache = new InMemoryCache();
    const throwing: CacheWarmLoader = {
      name: 'broken',
      key: (t) => `broken:${t}`,
      load: async () => {
        throw new Error('db unavailable');
      },
    };
    const working: CacheWarmLoader = {
      name: 'tenant-configurations',
      key: (t) => CacheKeys.tenantConfigurations(t),
      load: async () => [{ key: 'k', value: 1 }],
    };
    const warmer = new CacheWarmer({ cache, loaders: [throwing, working], logger: silentLogger() });

    const count = await warmer.warmTenant('t1');

    // The broken loader was skipped; the working one still warmed its entry.
    expect(count).toBe(1);
    expect(await cache.get(CacheKeys.tenantConfigurations('t1'))).toEqual([{ key: 'k', value: 1 }]);
  });

  it('warms multiple tenants and returns the total entries cached', async () => {
    const cache = new InMemoryCache();
    const loader: CacheWarmLoader = {
      name: 'tenant-configurations',
      key: (t) => CacheKeys.tenantConfigurations(t),
      load: async (tenantId) => [{ key: 'tenant', value: tenantId }],
    };
    const warmer = new CacheWarmer({ cache, loaders: [loader] });

    const total = await warmer.warmTenants(['t1', 't2', 't3']);

    expect(total).toBe(3);
    expect(await cache.get(CacheKeys.tenantConfigurations('t2'))).toEqual([
      { key: 'tenant', value: 't2' },
    ]);
  });
});
