import { describe, it, expect, vi } from 'vitest';
import type { Environment } from '@config/environment';
import { InMemoryCache } from './in-memory-cache.js';
import {
  RedisCache,
  buildCache,
  type RedisClient,
  type RedisClientLoader,
  type CacheLogger,
} from './redis-cache.js';

/**
 * Environment stub. Only the Redis fields are meaningful; the rest satisfy the
 * type via a cast so we do not pull in the real loader (which needs a
 * DATABASE_URL etc.).
 */
function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    NODE_ENV: 'test',
    REDIS_TLS: false,
    ...overrides,
  } as Environment;
}

/** A silent logger so tests do not spam the console. */
function silentLogger(): CacheLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

/**
 * In-memory fake {@link RedisClient} with lazy TTL expiry and a controllable
 * clock. Records the ttl passed to `set` so tests can assert pass-through.
 */
class FakeRedisClient implements RedisClient {
  public readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  public readonly setTtls: Array<number | undefined> = [];
  public quitCalled = 0;

  constructor(private now: () => number = () => 0) {}

  get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (entry === undefined) return Promise.resolve(null);
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.setTtls.push(ttlSeconds);
    const expiresAt = ttlSeconds !== undefined ? this.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  quit(): Promise<void> {
    this.quitCalled += 1;
    return Promise.resolve();
  }
}

/** A fake client whose every command rejects — simulates a Redis outage. */
class ThrowingRedisClient implements RedisClient {
  get(): Promise<string | null> {
    return Promise.reject(new Error('connection refused'));
  }
  set(): Promise<void> {
    return Promise.reject(new Error('connection refused'));
  }
  del(): Promise<void> {
    return Promise.reject(new Error('connection refused'));
  }
  quit(): Promise<void> {
    return Promise.resolve();
  }
}

describe('RedisCache', () => {
  it('round-trips get/set/del through the client', async () => {
    const client = new FakeRedisClient();
    const cache = new RedisCache({ loader: async () => client, logger: silentLogger() });

    expect(await cache.get('k')).toBeNull();
    await cache.set('k', { hello: 'world' });
    expect(await cache.get<{ hello: string }>('k')).toEqual({ hello: 'world' });
    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('JSON-serialises values on set and deserialises on get', async () => {
    const client = new FakeRedisClient();
    const cache = new RedisCache({ loader: async () => client, logger: silentLogger() });

    await cache.set('obj', { n: 1, arr: [1, 2, 3], nested: { ok: true } });
    // The client stores a raw JSON string...
    expect(client.store.get('obj')?.value).toBe('{"n":1,"arr":[1,2,3],"nested":{"ok":true}}');
    // ...and get reconstructs the structured value.
    expect(await cache.get('obj')).toEqual({ n: 1, arr: [1, 2, 3], nested: { ok: true } });
  });

  it('passes the TTL through to the client', async () => {
    const client = new FakeRedisClient();
    const cache = new RedisCache({ loader: async () => client, logger: silentLogger() });

    await cache.set('k', 'v', 60);
    expect(client.setTtls).toEqual([60]);
  });

  it('omits the TTL when none (or a non-positive one) is given', async () => {
    const client = new FakeRedisClient();
    const cache = new RedisCache({ loader: async () => client, logger: silentLogger() });

    await cache.set('a', 'v');
    await cache.set('b', 'v', 0);
    await cache.set('c', 'v', -5);
    expect(client.setTtls).toEqual([undefined, undefined, undefined]);
  });

  it('applies the configured key prefix to every key', async () => {
    const client = new FakeRedisClient();
    const cache = new RedisCache({
      loader: async () => client,
      keyPrefix: 'carlos:test:',
      logger: silentLogger(),
    });

    await cache.set('branding:t1', 'v');
    expect([...client.store.keys()]).toEqual(['carlos:test:branding:t1']);
    expect(await cache.get('branding:t1')).toBe('v');
    await cache.del('branding:t1');
    expect(client.store.size).toBe(0);
  });

  it('connects lazily and memoises the client (loader called once)', async () => {
    const client = new FakeRedisClient();
    const loader = vi.fn<RedisClientLoader>(async () => client);
    const cache = new RedisCache({ loader, logger: silentLogger() });

    // Not called at construction time.
    expect(loader).not.toHaveBeenCalled();

    await cache.set('k', 'v');
    await cache.get('k');
    await cache.del('k');

    // Called exactly once across multiple operations.
    expect(loader).toHaveBeenCalledTimes(1);
  });

  describe('graceful degradation (never throws)', () => {
    it('returns null from get when the client throws', async () => {
      const logger = silentLogger();
      const cache = new RedisCache({ loader: async () => new ThrowingRedisClient(), logger });

      await expect(cache.get('k')).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('no-ops set/del when the client throws', async () => {
      const logger = silentLogger();
      const cache = new RedisCache({ loader: async () => new ThrowingRedisClient(), logger });

      await expect(cache.set('k', 'v')).resolves.toBeUndefined();
      await expect(cache.del('k')).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('degrades to a miss when the lazy connect itself fails, and retries next time', async () => {
      const good = new FakeRedisClient();
      const logger = silentLogger();
      let attempt = 0;
      const loader: RedisClientLoader = async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error('connect failed');
        }
        return good;
      };
      const cache = new RedisCache({ loader, logger });

      // First op: connect fails → miss, no throw.
      expect(await cache.get('k')).toBeNull();
      // Second op: connect retried (promise was reset) and now succeeds.
      await cache.set('k', 'v');
      expect(await cache.get('k')).toBe('v');
      expect(attempt).toBe(2);
    });
  });
});

describe('buildCache', () => {
  it('returns an InMemoryCache when REDIS_URL is absent', () => {
    const cache = buildCache(makeEnv(), { logger: silentLogger() });
    expect(cache).toBeInstanceOf(InMemoryCache);
  });

  it('treats a blank REDIS_URL as absent', () => {
    const cache = buildCache(makeEnv({ REDIS_URL: '   ' }), { logger: silentLogger() });
    expect(cache).toBeInstanceOf(InMemoryCache);
  });

  it('returns a RedisCache when REDIS_URL is set (using the injected loader)', async () => {
    const client = new FakeRedisClient();
    const loader = vi.fn<RedisClientLoader>(async () => client);
    const cache = buildCache(makeEnv({ REDIS_URL: 'redis://localhost:6379' }), {
      loader,
      logger: silentLogger(),
    });

    expect(cache).toBeInstanceOf(RedisCache);
    // Still lazy — nothing connected just by building.
    expect(loader).not.toHaveBeenCalled();

    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('honours REDIS_KEY_PREFIX from the environment', async () => {
    const client = new FakeRedisClient();
    const cache = buildCache(
      makeEnv({ REDIS_URL: 'redis://localhost:6379', REDIS_KEY_PREFIX: 'env-prefix:' }),
      { loader: async () => client, logger: silentLogger() },
    );

    await cache.set('k', 'v');
    expect([...client.store.keys()]).toEqual(['env-prefix:k']);
  });
});
