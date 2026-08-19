/**
 * Server-side session storage port (task 39.1, Requirement 31.2).
 *
 * The platform's primary authentication is stateless RS256 JWT carried in the
 * `Authorization` header (see the Auth module), and that remains unchanged. This
 * port is ADDITIVE: it provides a place to persist short-lived, server-owned
 * session state (e.g. step-up/MFA challenges, one-time flows, revocation lists,
 * or opt-in cookie sessions) in a way that works across horizontally-scaled,
 * stateless backend instances — every instance reads/writes the SAME shared
 * store rather than local memory (Requirement 31.2).
 *
 * Application code depends only on this framework-agnostic abstraction so the
 * backing technology can change without touching business logic (Clean
 * Architecture, Requirement 3.2). It is backed by Redis when `REDIS_URL` is
 * configured and by an in-process store otherwise — the latter is single-process
 * only and exists so local development and tests run without a Redis server.
 *
 * Session identifiers are opaque strings owned by the caller. Values are stored
 * and retrieved by their generic type `T` (JSON-serialised by the Redis
 * implementation); callers MUST treat a returned value as an independent
 * snapshot and not mutate shared state.
 */
export interface ISessionStore {
  /**
   * Returns the session payload for `sessionId`, or `null` when the session is
   * absent or its time-to-live has elapsed.
   */
  get<T>(sessionId: string): Promise<T | null>;

  /**
   * Persists `data` for `sessionId`. When `ttlSeconds` is provided (and > 0) the
   * session expires after that many seconds (idle/absolute expiry); when omitted
   * the session persists until explicitly deleted/overwritten.
   */
  set<T>(sessionId: string, data: T, ttlSeconds?: number): Promise<void>;

  /** Removes `sessionId` from the store (logout / invalidation). No-op when absent. */
  delete(sessionId: string): Promise<void>;

  /**
   * Extends the lifetime of an existing session by resetting its TTL to
   * `ttlSeconds` (sliding-expiry refresh on activity). A no-op when the session
   * is absent — it does NOT recreate an expired session.
   */
  touch(sessionId: string, ttlSeconds: number): Promise<void>;
}
