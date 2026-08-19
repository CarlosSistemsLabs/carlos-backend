import { describe, it, expect, vi } from 'vitest';
import type { ICache } from '@application/ports/cache.js';
import { InMemoryCache } from './in-memory-cache.js';
import { CacheKeys, invalidateCacheKeys } from './cache-keys.js';

describe('CacheKeys', () => {
  it('builds the branding key matching the Administration convention', () => {
    expect(CacheKeys.branding('t1')).toBe('branding:t1');
  });

  it('builds tenant configuration keys', () => {
    expect(CacheKeys.tenantConfigurations('t1')).toBe('tenant-config:t1');
    expect(CacheKeys.tenantConfiguration('t1', 'sales.defaultTaxRate')).toBe(
      'tenant-config:t1:sales.defaultTaxRate',
    );
  });

  it('builds a generic tenant-scoped entity key', () => {
    expect(CacheKeys.entity('product', 't1', 'p9')).toBe('product:t1:p9');
  });

  it('builds product/customer list version keys (task 39.4)', () => {
    expect(CacheKeys.productListVersion('t1')).toBe('product-list-version:t1');
    expect(CacheKeys.customerListVersion('t1')).toBe('customer-list-version:t1');
  });
});

describe('invalidateCacheKeys', () => {
  it('deletes every supplied key from the cache', async () => {
    const cache = new InMemoryCache();
    await cache.set('a', 1);
    await cache.set('b', 2);

    await invalidateCacheKeys(cache, ['a', 'b']);

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });

  it('attempts every key even if one del rejects (never throws)', async () => {
    let calls = 0;
    const cache: ICache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      del: vi.fn(async (key: string) => {
        calls += 1;
        if (key === 'boom') {
          throw new Error('del failed');
        }
      }),
    };

    await expect(invalidateCacheKeys(cache, ['ok1', 'boom', 'ok2'])).resolves.toBeUndefined();
    // All three deletes were attempted despite the middle one throwing.
    expect(calls).toBe(3);
  });
});
