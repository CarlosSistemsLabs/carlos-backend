/**
 * Cross-cutting cache abstraction port (design "Infrastructure Layer" → cache).
 *
 * Application code (use cases) depends only on this framework-agnostic port so
 * the concrete cache technology can change without touching business logic
 * (Clean Architecture, Requirement 3.2). An in-memory implementation
 * ({@link InMemoryCache}) backs it today; the Redis-backed implementation is
 * wired in task 39.1 **behind this exact same port**, so no consumer changes
 * are required when Redis lands.
 *
 * Keys are opaque strings owned by the caller (e.g. `branding:<tenantId>`).
 * Values are stored/retrieved by their generic type `T`; an implementation may
 * serialise them (Redis) or keep the reference (in-memory) — callers MUST treat
 * a returned value as an independent snapshot and not mutate shared state.
 */
export interface ICache {
  /**
   * Returns the cached value for `key`, or `null` when the key is absent or its
   * time-to-live has elapsed.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Stores `value` under `key`. When `ttlSeconds` is provided (and > 0) the
   * entry expires after that many seconds; when omitted the entry does not
   * expire until explicitly deleted/overwritten.
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /** Removes `key` from the cache. A no-op when the key is absent. */
  del(key: string): Promise<void>;
}
