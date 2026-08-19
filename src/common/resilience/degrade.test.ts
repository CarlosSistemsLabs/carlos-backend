import { describe, it, expect, vi } from 'vitest';
import { ForbiddenError, ValidationError } from '@domain/errors/index.js';
import { CircuitOpenError } from './circuit-breaker.js';
import {
  isDegradableError,
  isNonCriticalError,
  staleOnError,
  withFallback,
  type DegradationCache,
  type DegradationLogger,
} from './degrade.js';

/**
 * Tests for the GRACEFUL-DEGRADATION helpers (task 41.4, Requirements 20.5 &
 * 27.7). Fully deterministic: no timers, no network; the logger and cache are
 * simple in-memory fakes.
 */

/** A recording {@link DegradationLogger} so tests can assert the degraded line. */
function makeLogger(): DegradationLogger & { calls: Array<{ message: string; meta?: Record<string, unknown> }> } {
  const calls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  return {
    calls,
    info(message: string, meta?: Record<string, unknown>): void {
      calls.push(meta === undefined ? { message } : { message, meta });
    },
  };
}

/** A minimal in-memory {@link DegradationCache} for the stale-on-error tests. */
class FakeCache implements DegradationCache {
  private readonly store = new Map<string, unknown>();

  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.store.has(key) ? (this.store.get(key) as T) : null));
  }

  set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }
}

describe('degrade predicates', () => {
  it('isDegradableError degrades only transient/unavailable domain errors', () => {
    expect(isDegradableError(new CircuitOpenError())).toBe(true);
    expect(isDegradableError(new ForbiddenError('nope'))).toBe(false);
    expect(isDegradableError(new ValidationError('bad'))).toBe(false);
    // An opaque (non-domain) error is NOT degradable under the strict default.
    expect(isDegradableError(new Error('boom'))).toBe(false);
  });

  it('isNonCriticalError degrades transient + opaque errors but not deliberate domain refusals', () => {
    expect(isNonCriticalError(new CircuitOpenError())).toBe(true);
    expect(isNonCriticalError(new Error('db down'))).toBe(true);
    expect(isNonCriticalError(new ForbiddenError('nope'))).toBe(false);
    expect(isNonCriticalError(new ValidationError('bad'))).toBe(false);
  });
});

describe('withFallback', () => {
  it('returns the primary value on success without invoking the fallback', async () => {
    const fallback = vi.fn(() => 'fallback');
    const result = await withFallback(() => Promise.resolve('primary'), fallback);

    expect(result).toBe('primary');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('returns the fallback value and logs a degraded event on a transient failure', async () => {
    const logger = makeLogger();
    const result = await withFallback(
      () => Promise.reject(new CircuitOpenError('ai down')),
      () => 'fallback',
      { feature: 'ai:query', logger },
    );

    expect(result).toBe('fallback');
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.meta).toMatchObject({
      event: 'degraded',
      feature: 'ai:query',
    });
  });

  it('awaits an async fallback', async () => {
    const result = await withFallback(
      () => Promise.reject(new CircuitOpenError()),
      () => Promise.resolve(42),
    );

    expect(result).toBe(42);
  });

  it('re-throws (does NOT degrade) a deliberate domain error and never logs', async () => {
    const logger = makeLogger();
    const fallback = vi.fn(() => 'fallback');

    await expect(
      withFallback(() => Promise.reject(new ForbiddenError('denied')), fallback, { logger }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(fallback).not.toHaveBeenCalled();
    expect(logger.calls).toHaveLength(0);
  });

  it('honours a custom shouldDegrade predicate', async () => {
    // Broaden degradation to include opaque errors for this call site.
    const result = await withFallback(
      () => Promise.reject(new Error('db blip')),
      () => 'stale',
      { shouldDegrade: isNonCriticalError },
    );

    expect(result).toBe('stale');
  });

  it('propagates an error thrown by the fallback itself', async () => {
    await expect(
      withFallback(
        () => Promise.reject(new CircuitOpenError()),
        () => {
          throw new Error('fallback failed');
        },
      ),
    ).rejects.toThrow('fallback failed');
  });
});

describe('staleOnError', () => {
  it('returns the live value and refreshes the snapshot on success', async () => {
    const cache = new FakeCache();
    const result = await staleOnError(cache, 'k', () => Promise.resolve('live'));

    expect(result).toBe('live');
    expect(await cache.get('k')).toBe('live');
  });

  it('serves the cached snapshot when the live load fails transiently', async () => {
    const cache = new FakeCache();
    const logger = makeLogger();
    await cache.set('k', 'last-known-good');

    const result = await staleOnError(cache, 'k', () => Promise.reject(new Error('db down')), {
      feature: 'tenant-branding',
      logger,
    });

    expect(result).toBe('last-known-good');
    expect(logger.calls[0]?.meta).toMatchObject({ event: 'degraded', stale: true });
  });

  it('re-throws when the live load fails and no snapshot exists', async () => {
    const cache = new FakeCache();

    await expect(
      staleOnError(cache, 'k', () => Promise.reject(new Error('db down'))),
    ).rejects.toThrow('db down');
  });

  it('re-throws a deliberate domain error without consulting the cache', async () => {
    const cache = new FakeCache();
    await cache.set('k', 'last-known-good');

    await expect(
      staleOnError(cache, 'k', () => Promise.reject(new ForbiddenError('denied'))),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
