import type { ISessionStore } from '@application/ports/session-store.js';
import type { ICache } from '@application/ports/cache.js';
import type { Environment } from '@config/environment';
import { InMemoryCache } from './in-memory-cache.js';
import { RedisCache, buildCache, type CacheDeps, type CacheLogger } from './redis-cache.js';

/**
 * Server-side session storage implementations (task 39.1, Requirement 31.2).
 *
 * Both implementations are built ON TOP of an {@link ICache}, so they inherit its
 * TTL semantics and — for the Redis variant — its never-throws graceful
 * degradation. This is ADDITIVE session storage: the platform's stateless JWT
 * auth is unchanged; this provides a shared place to keep short-lived,
 * server-owned session state that works across horizontally-scaled backend
 * instances (Requirement 31.2).
 *
 * Session ids are namespaced under a `session:` key prefix so they never collide
 * with ordinary cache entries sharing the same store.
 */

/** Default key namespace applied to every session id. */
const SESSION_KEY_PREFIX = 'session:';

/**
 * Shared {@link ISessionStore} behaviour over any {@link ICache}. `touch`
 * implements sliding expiry by re-reading the current payload and re-writing it
 * with a fresh TTL — a no-op when the session has already expired (so it never
 * resurrects a dead session), using only the minimal cache surface.
 */
abstract class CacheBackedSessionStore implements ISessionStore {
  protected constructor(
    private readonly cache: ICache,
    private readonly namespace: string = SESSION_KEY_PREFIX,
  ) {}

  get<T>(sessionId: string): Promise<T | null> {
    return this.cache.get<T>(this.key(sessionId));
  }

  set<T>(sessionId: string, data: T, ttlSeconds?: number): Promise<void> {
    return this.cache.set(this.key(sessionId), data, ttlSeconds);
  }

  delete(sessionId: string): Promise<void> {
    return this.cache.del(this.key(sessionId));
  }

  async touch(sessionId: string, ttlSeconds: number): Promise<void> {
    const current = await this.cache.get<unknown>(this.key(sessionId));
    if (current === null) {
      return;
    }
    await this.cache.set(this.key(sessionId), current, ttlSeconds);
  }

  private key(sessionId: string): string {
    return `${this.namespace}${sessionId}`;
  }
}

/**
 * Redis-backed {@link ISessionStore} for the stateless, horizontally-scaled
 * backend (Requirement 31.2): every instance reads/writes the SAME Redis store,
 * so a user's session is visible regardless of which instance serves the
 * request. Built over a {@link RedisCache} (same lazy client, JSON serialisation
 * and never-throws degradation).
 */
export class RedisSessionStore extends CacheBackedSessionStore {
  constructor(cache: RedisCache, namespace: string = SESSION_KEY_PREFIX) {
    super(cache, namespace);
  }
}

/**
 * In-process {@link ISessionStore} used when Redis is not configured. Backed by
 * an {@link InMemoryCache}, it is single-process only (sessions are NOT shared
 * across instances) — suitable for local development and tests, exactly the
 * cross-instance guarantee the Redis variant adds in production.
 */
export class InMemorySessionStore extends CacheBackedSessionStore {
  constructor(namespace: string = SESSION_KEY_PREFIX) {
    super(new InMemoryCache(), namespace);
  }
}

/**
 * Builds the session store for the running environment (task 39.1).
 *
 * - `REDIS_URL` present → a {@link RedisSessionStore} over a lazily-connected
 *   {@link RedisCache} (nothing connects at boot).
 * - `REDIS_URL` absent → an {@link InMemorySessionStore}.
 *
 * Mirrors {@link buildCache}: env alone selects the backing store, so TEST and
 * PRODUCTION use separate Redis instances automatically (Requirement 14.2-style).
 *
 * @param environment - Environment configuration.
 * @param deps - Optional test seams (client loader, logger) forwarded to the cache.
 */
export function buildSessionStore(environment: Environment, deps: CacheDeps = {}): ISessionStore {
  const url = environment.REDIS_URL?.trim();
  if (url === undefined || url === '') {
    (deps.logger ?? defaultSessionLogger).info(
      { sessionStore: 'in-memory' },
      'Session store backed by in-process store: REDIS_URL not set',
    );
    return new InMemorySessionStore();
  }

  const cache = buildCache(environment, deps);
  // buildCache returns a RedisCache on the enabled path; narrow defensively so a
  // (theoretical) non-Redis cache still yields a working store.
  if (cache instanceof RedisCache) {
    (deps.logger ?? defaultSessionLogger).info(
      { sessionStore: 'redis' },
      'Session store backed by Redis (lazy connect)',
    );
    return new RedisSessionStore(cache);
  }
  return new InMemorySessionStore();
}

/** Fallback logger used before the application's pino logger is injected. */
const defaultSessionLogger: CacheLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- boot-time fallback before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
};
