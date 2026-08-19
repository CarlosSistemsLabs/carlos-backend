import { describe, it, expect } from 'vitest';
import { NoOpCache } from './no-op-cache.js';

describe('NoOpCache', () => {
  it('always misses on get', async () => {
    const cache = new NoOpCache();
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBeNull();
  });

  it('set and del are no-ops that never throw', async () => {
    const cache = new NoOpCache();
    await expect(cache.set('k', 'v', 60)).resolves.toBeUndefined();
    await expect(cache.del('k')).resolves.toBeUndefined();
  });
});
