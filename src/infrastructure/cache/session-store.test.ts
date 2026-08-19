import { describe, it, expect, vi } from 'vitest';
import type { Environment } from '@config/environment';
import {
  RedisCache,
  type RedisClient,
  type RedisClientLoader,
  type CacheLogger,
} from './redis-cache.js';
import {
  RedisSessionStore,
  InMemorySessionStore,
  buildSessionStore,
} from './session-store.js';

function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    NODE_ENV: 'test',
    REDIS_TLS: false,
    ...overrides,
  } as Environment;
}

function silentLogger(): CacheLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

/** In-memory fake {@link RedisClient} with a controllable clock for TTL. */
class FakeRedisClient implements RedisClient {
  public readonly store = new Map<string, { value: string; expiresAt: number | null }>();

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
    const expiresAt = ttlSeconds !== undefined ? this.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  quit(): Promise<void> {
    return Promise.resolve();
  }
}

function redisSessionStore(now: () => number = () => 0): {
  store: RedisSessionStore;
  client: FakeRedisClient;
} {
  const client = new FakeRedisClient(now);
  const cache = new RedisCache({ loader: async () => client, logger: silentLogger() });
  return { store: new RedisSessionStore(cache), client };
}

describe('RedisSessionStore', () => {
  it('round-trips get/set/delete a session by id', async () => {
    const { store } = redisSessionStore();

    expect(await store.get('sess-1')).toBeNull();
    await store.set('sess-1', { userId: 'u1', roles: ['admin'] });
    expect(await store.get<{ userId: string }>('sess-1')).toEqual({
      userId: 'u1',
      roles: ['admin'],
    });
    await store.delete('sess-1');
    expect(await store.get('sess-1')).toBeNull();
  });

  it('namespaces session ids under the session: key prefix', async () => {
    const { store, client } = redisSessionStore();

    await store.set('abc', { userId: 'u1' });
    expect([...client.store.keys()]).toEqual(['session:abc']);
  });

  it('stores sessions with a TTL and expires them', async () => {
    let now = 0;
    const { store } = redisSessionStore(() => now);

    await store.set('sess-1', { userId: 'u1' }, 60);
    now += 59_000;
    expect(await store.get('sess-1')).toEqual({ userId: 'u1' });
    now += 2_000; // past the 60s TTL
    expect(await store.get('sess-1')).toBeNull();
  });

  it('touch extends the TTL of an existing session', async () => {
    let now = 0;
    const { store } = redisSessionStore(() => now);

    await store.set('sess-1', { userId: 'u1' }, 60);
    now += 50_000;
    await store.touch('sess-1', 60); // resets expiry to now + 60s
    now += 50_000; // 100s since original set, but only 50s since touch
    expect(await store.get('sess-1')).toEqual({ userId: 'u1' });
  });

  it('touch is a no-op for an absent/expired session (does not resurrect it)', async () => {
    const { store } = redisSessionStore();

    await store.touch('missing', 60);
    expect(await store.get('missing')).toBeNull();
  });

  it('never throws when the underlying client fails (graceful degradation)', async () => {
    const cache = new RedisCache({
      loader: async () => {
        throw new Error('outage');
      },
      logger: silentLogger(),
    });
    const store = new RedisSessionStore(cache);

    await expect(store.get('s')).resolves.toBeNull();
    await expect(store.set('s', { a: 1 })).resolves.toBeUndefined();
    await expect(store.delete('s')).resolves.toBeUndefined();
    await expect(store.touch('s', 60)).resolves.toBeUndefined();
  });
});

describe('InMemorySessionStore', () => {
  it('round-trips get/set/delete', async () => {
    const store = new InMemorySessionStore();
    await store.set('s', { userId: 'u1' });
    expect(await store.get('s')).toEqual({ userId: 'u1' });
    await store.delete('s');
    expect(await store.get('s')).toBeNull();
  });

  it('touch is a no-op when the session is absent', async () => {
    const store = new InMemorySessionStore();
    await store.touch('nope', 60);
    expect(await store.get('nope')).toBeNull();
  });
});

describe('buildSessionStore', () => {
  it('returns an InMemorySessionStore when REDIS_URL is absent', () => {
    const store = buildSessionStore(makeEnv(), { logger: silentLogger() });
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('returns a RedisSessionStore when REDIS_URL is set (using the injected loader)', async () => {
    const client = new FakeRedisClient();
    const loader = vi.fn<RedisClientLoader>(async () => client);
    const store = buildSessionStore(makeEnv({ REDIS_URL: 'redis://localhost:6379' }), {
      loader,
      logger: silentLogger(),
    });

    expect(store).toBeInstanceOf(RedisSessionStore);
    // Lazy — nothing connected just by building.
    expect(loader).not.toHaveBeenCalled();

    await store.set('s', { userId: 'u1' });
    expect(await store.get('s')).toEqual({ userId: 'u1' });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
