import type { ICache } from '@application/ports/cache.js';
import type { Environment } from '@config/environment';
import { InMemoryCache } from './in-memory-cache.js';

/**
 * Redis-backed {@link ICache} implementation for distributed caching (task 39.1,
 * Requirement 31.2).
 *
 * This module owns the backend's single entry point to Redis for caching. It
 * satisfies the SAME {@link ICache} port as {@link InMemoryCache}, so no consumer
 * changes are required — {@link buildCache} decides which implementation to bind
 * based purely on whether `REDIS_URL` is configured (Requirement 14.2-style
 * environment separation via env alone).
 *
 * **Deferred dependency.** The `redis` npm package is intentionally NOT a hard
 * dependency here: this environment sits behind an SSL-inspecting proxy that
 * blocks its installation. The real client is therefore loaded lazily via a
 * dynamic import ({@link defaultRedisClientLoader}) that only runs on the ENABLED
 * path, and the client surface we consume is abstracted behind
 * {@link RedisClient} so a fake can be injected in tests. Install `redis` in CI /
 * real deployments (`npm i redis`) to activate the enabled path.
 *
 * **Lazy connect.** The client is not created or connected until the FIRST cache
 * operation, so binding a {@link RedisCache} at composition time never blocks
 * boot or opens a socket. A failed lazy connect is treated like any other Redis
 * fault (see below) and retried on the next operation.
 *
 * **Never throws — graceful degradation.** Every operation defends against Redis
 * being slow, unreachable or misbehaving: on ANY error the cache logs a warning
 * and behaves as a cache MISS (`get` → `null`) or a NO-OP (`set`/`del`). A Redis
 * outage therefore degrades the system to "no cache" — requests still succeed by
 * recomputing/refetching — rather than surfacing errors to callers. This is the
 * explicit contract of an {@link ICache} implementation here.
 */

/**
 * The minimal subset of a Redis client this cache consumes. Modelling it as an
 * interface lets tests inject an in-memory fake and keeps the enabled path
 * decoupled from the concrete `redis` package (which is dynamically imported and
 * adapted to this shape by {@link defaultRedisClientLoader}).
 *
 * Values are opaque strings — serialisation is the cache's concern, not the
 * client's.
 */
export interface RedisClient {
  /** Returns the raw string value for `key`, or `null` when absent/expired. */
  get(key: string): Promise<string | null>;
  /**
   * Stores `value` under `key`. When `ttlSeconds` is provided (and > 0) the
   * entry is written with that expiry (Redis `SET ... EX <ttlSeconds>`);
   * otherwise it is written without expiry.
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Removes `key`. A no-op when the key is absent. */
  del(key: string): Promise<void>;
  /** Closes the connection (graceful `QUIT`). */
  quit(): Promise<void>;
}

/**
 * Loads a connected {@link RedisClient}. Injected in tests (a fake); defaults to
 * a dynamic import of the `redis` package on the enabled path.
 */
export type RedisClientLoader = () => Promise<RedisClient>;

/**
 * Minimal structural logger the cache depends on — a subset of pino / the
 * application's structured logger. Kept local so this infrastructure module does
 * not couple to any feature module's logger type.
 */
export interface CacheLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** Options for constructing a {@link RedisCache}. */
export interface RedisCacheOptions {
  /** Loads the connected Redis client (invoked lazily, once, on first use). */
  loader: RedisClientLoader;
  /** Optional key prefix applied to every key (e.g. `carlos:test:`). */
  keyPrefix?: string;
  /** Structured logger for the degradation warnings. */
  logger?: CacheLogger;
}

/**
 * {@link ICache} backed by Redis, with JSON (de)serialisation, an optional key
 * prefix, lazy connect and never-throws graceful degradation. See the module
 * doc-comment for the full contract.
 */
export class RedisCache implements ICache {
  private readonly loader: RedisClientLoader;
  private readonly keyPrefix: string;
  private readonly logger: CacheLogger;
  /** Cached connection attempt; reset to `undefined` on failure so it retries. */
  private clientPromise: Promise<RedisClient> | undefined;

  constructor(options: RedisCacheOptions) {
    this.loader = options.loader;
    this.keyPrefix = options.keyPrefix ?? '';
    this.logger = options.logger ?? defaultCacheLogger;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const raw = await client.get(this.prefixed(key));
      if (raw === null) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      // Degrade to a cache MISS — never throw to the caller.
      this.logger.warn(
        { cache: 'redis', op: 'get', key, error: errorMessage(error) },
        'Redis cache get failed; treating as a miss',
      );
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const client = await this.getClient();
      const serialized = JSON.stringify(value);
      const ttl = ttlSeconds !== undefined && ttlSeconds > 0 ? ttlSeconds : undefined;
      await client.set(this.prefixed(key), serialized, ttl);
    } catch (error) {
      // Degrade to a NO-OP — never throw to the caller.
      this.logger.warn(
        { cache: 'redis', op: 'set', key, error: errorMessage(error) },
        'Redis cache set failed; skipping cache write',
      );
    }
  }

  async del(key: string): Promise<void> {
    try {
      const client = await this.getClient();
      await client.del(this.prefixed(key));
    } catch (error) {
      // Degrade to a NO-OP — never throw to the caller.
      this.logger.warn(
        { cache: 'redis', op: 'del', key, error: errorMessage(error) },
        'Redis cache del failed; skipping cache delete',
      );
    }
  }

  /**
   * Resolves the shared client, connecting lazily on first use. The connection
   * promise is memoised; if it rejects it is cleared so the NEXT operation
   * transparently retries (recovering from a transient outage).
   */
  private getClient(): Promise<RedisClient> {
    if (this.clientPromise === undefined) {
      const attempt = this.loader().catch((error: unknown) => {
        this.clientPromise = undefined;
        throw error;
      });
      this.clientPromise = attempt;
    }
    return this.clientPromise;
  }

  /** Prepends the configured key prefix (if any) to `key`. */
  private prefixed(key: string): string {
    return this.keyPrefix === '' ? key : `${this.keyPrefix}${key}`;
  }
}

/**
 * Builds the cache implementation for the running environment (task 39.1).
 *
 * - `REDIS_URL` absent → returns an {@link InMemoryCache} (the single-process
 *   default) and logs a single info line. Nothing connects; the app boots with a
 *   working local cache.
 * - `REDIS_URL` present → returns a {@link RedisCache} bound to a lazily-loaded
 *   client (nothing connects at boot; the socket opens on first use). The
 *   optional `REDIS_KEY_PREFIX` namespaces keys.
 *
 * Mirrors `buildFirebaseAdmin`: env is the sole source, so TEST and PRODUCTION
 * point at separate Redis instances automatically (Requirement 14.2-style).
 *
 * @param environment - Environment configuration.
 * @param deps - Optional test seams (client loader, logger).
 */
export function buildCache(environment: Environment, deps: CacheDeps = {}): ICache {
  const logger = deps.logger ?? defaultCacheLogger;
  const url = environment.REDIS_URL?.trim();

  if (url === undefined || url === '') {
    logger.info({ cache: 'in-memory' }, 'Cache backed by in-process store: REDIS_URL not set');
    return new InMemoryCache();
  }

  const loader = deps.loader ?? defaultRedisClientLoader(url, environment.REDIS_TLS ?? false);
  logger.info({ cache: 'redis' }, 'Cache backed by Redis (lazy connect)');
  return new RedisCache({
    loader,
    logger,
    ...(environment.REDIS_KEY_PREFIX !== undefined
      ? { keyPrefix: environment.REDIS_KEY_PREFIX }
      : {}),
  });
}

/** Dependencies for {@link buildCache}; all optional (test seams). */
export interface CacheDeps {
  /** Loads the connected Redis client (defaults to a dynamic import of `redis`). */
  loader?: RedisClientLoader;
  /** Structured logger for the boot line + degradation warnings. */
  logger?: CacheLogger;
}

/**
 * Default client loader: dynamically imports `redis`, creates a client for
 * `url`, connects it, and adapts the node-redis v4 surface to {@link RedisClient}.
 *
 * The package specifier is held in a variable so the TypeScript compiler does
 * not attempt to resolve the (deliberately uninstalled) module at build time; it
 * resolves at runtime only on the enabled path, when the package is present.
 */
export function defaultRedisClientLoader(url: string, tls: boolean): RedisClientLoader {
  return async (): Promise<RedisClient> => {
    const moduleName = 'redis';
    const mod = (await import(moduleName)) as {
      createClient: (options: RedisCreateClientOptions) => NodeRedisClient;
    };
    const client = mod.createClient({
      url,
      ...(tls ? { socket: { tls: true } } : {}),
    });
    // Prevent an unhandled 'error' event from crashing the process; connection
    // faults surface through the awaited command promises (and are degraded to
    // cache misses / no-ops by RedisCache).
    client.on('error', () => {
      /* swallowed — see RedisCache graceful degradation */
    });
    await client.connect();
    return adaptNodeRedisClient(client);
  };
}

/** Adapts a connected node-redis v4 client to the minimal {@link RedisClient}. */
function adaptNodeRedisClient(client: NodeRedisClient): RedisClient {
  return {
    async get(key) {
      return client.get(key);
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds !== undefined) {
        await client.set(key, value, { EX: ttlSeconds });
      } else {
        await client.set(key, value);
      }
    },
    async del(key) {
      await client.del(key);
    },
    async quit() {
      await client.quit();
    },
  };
}

/** Options accepted by node-redis `createClient` that we set. */
interface RedisCreateClientOptions {
  url: string;
  socket?: { tls?: boolean };
}

/** The node-redis v4 client surface consumed by {@link adaptNodeRedisClient}. */
interface NodeRedisClient {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  connect(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

/** Fallback logger used before the application's pino logger is injected. */
const defaultCacheLogger: CacheLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- boot-time fallback before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
};

/** Extracts a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
