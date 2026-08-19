import type { ICache } from '@application/ports/cache.js';

/**
 * A null-object {@link ICache} that stores nothing and always misses (task 39.4).
 *
 * Query-result caching is an OPTIONAL optimisation layered onto the list/search
 * and configuration use cases. To keep those use cases usable without a cache
 * (and to preserve their pre-caching behaviour for existing callers/tests that
 * do not inject one), they default their cache dependency to this null object:
 *
 * - {@link get} always returns `null` (a miss), so every read falls through to
 *   the repository — exactly as it did before caching was added;
 * - {@link set} and {@link del} are no-ops.
 *
 * It honours the never-throws {@link ICache} contract trivially. In production
 * the composition root injects the real (multi-level) cache, so this default is
 * only ever used in isolation (e.g. unit tests that don't care about caching).
 */
export class NoOpCache implements ICache {
  get<T>(_key: string): Promise<T | null> {
    return Promise.resolve(null);
  }

  set<T>(_key: string, _value: T, _ttlSeconds?: number): Promise<void> {
    return Promise.resolve();
  }

  del(_key: string): Promise<void> {
    return Promise.resolve();
  }
}
