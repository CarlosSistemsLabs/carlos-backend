import { DomainError, ErrorCode } from '@domain/errors/index.js';

/**
 * Resilience — GRACEFUL DEGRADATION (task 41.4, Requirements 20.5 & 27.7).
 *
 * ## What this module is
 * Where the {@link import('./circuit-breaker.js').CircuitBreaker} and
 * {@link import('./retry.js').retry} policies decide HOW to call a flaky
 * dependency, this module decides what to do WHEN a NON-CRITICAL feature fails
 * anyway: instead of failing the whole request it substitutes a sensible
 * FALLBACK (a friendly "temporarily unavailable" payload, or the last-known
 * CACHED/STALE value) so the caller degrades gracefully rather than erroring
 * (Requirement 27.7). This is the same principle the AI layer already applies
 * (`ResilientAIService` throwing `AIUnavailableError` for callers to degrade —
 * Requirement 20.5); {@link withFallback} turns that principle into a reusable
 * combinator any call site can compose.
 *
 * ## Critical vs non-critical — WHAT may degrade (feature classification)
 * Degradation is only ever correct for NON-CRITICAL features — those where a
 * slightly stale or generic answer is preferable to an error, and where serving
 * one cannot corrupt state or mislead a money/stock decision. The platform
 * classifies its read/enhancement paths as follows:
 *
 * **Non-critical — SAFE to degrade (serve fallback / stale cache):**
 * - AI enhancements (sales assistant, NL query, AI report narrative). The core
 *   ERP works without them; a "temporarily unavailable" reply is fine
 *   (Requirement 20.5).
 * - Tenant BRANDING / customization reads (logo, colours, theme). Purely
 *   presentational; last-known branding renders the UI perfectly well
 *   (Requirement 11.2). Serving a few-minutes-stale logo harms nothing.
 * - Tenant CONFIGURATION / non-financial settings reads and cached
 *   product/customer LIST projections — read-mostly catalogue data whose brief
 *   staleness is already bounded by their cache TTL (task 39.4).
 *
 * **Critical — MUST fail hard (never degrade, never serve stale):**
 * - Authentication / authorization decisions — a stale "allow" is a security
 *   hole.
 * - Cash, payment, invoice totals and account balances — a stale number is a
 *   wrong financial figure.
 * - Stock/inventory quantities used to accept an order or commit a movement —
 *   stale stock oversells.
 * - Any WRITE / mutation — degradation applies to reads/enhancements only; a
 *   failed write must surface so the caller knows it did not persist.
 *
 * The default {@link isDegradableError} / {@link isNonCriticalError} predicates
 * encode the "transient, not a deliberate domain refusal" half of this rule;
 * the CALLER is responsible for only wrapping paths that appear in the
 * non-critical list above.
 *
 * ## Determinism / never-throws
 * {@link withFallback} takes an INJECTABLE logger (defaults to a no-op) so tests
 * assert the structured `event: 'degraded'` line without touching a real logger,
 * and it NEVER throws when a fallback is supplied — unless the fallback itself
 * throws, or the error is one the predicate declines to degrade (in which case
 * the original error is re-thrown untouched so validation/auth failures still
 * surface).
 */

/* -------------------------------------------------------------------------- */
/* Logger + predicate contracts                                               */
/* -------------------------------------------------------------------------- */

/**
 * Minimal structured logger this module writes its `event: 'degraded'` line to.
 * Structurally compatible with the app logger and with a bare
 * `{ info: () => undefined }` stub in tests. Injectable so degradation is
 * observable without coupling the resilience layer to a concrete logger.
 */
export interface DegradationLogger {
  /** Emits a structured info record. `meta` carries the degradation context. */
  info(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Predicate deciding whether a failure is eligible for graceful degradation.
 * Returning `false` means "this is a deliberate/deterministic outcome — surface
 * it", so the original error is re-thrown unchanged.
 *
 * @param error - The error thrown by the primary operation.
 * @returns `true` to substitute the fallback, `false` to re-throw.
 */
export type DegradePredicate = (error: unknown) => boolean;

/**
 * Domain error codes treated as TRANSIENT / unavailable — the failures for
 * which degrading to a fallback is appropriate. Deliberately narrow: a
 * dependency is temporarily down or slow, not refusing the request.
 *
 * - {@link ErrorCode.SERVICE_UNAVAILABLE} — an OPEN circuit breaker
 *   (`CircuitOpenError`, Requirement 27.3).
 * - {@link ErrorCode.AI_UNAVAILABLE} — no AI provider available (Requirement 20.5).
 * - {@link ErrorCode.AI_TIMEOUT} — an AI operation exceeded its budget
 *   (Requirement 20.4).
 */
export const DEGRADABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  ErrorCode.SERVICE_UNAVAILABLE,
  ErrorCode.AI_UNAVAILABLE,
  ErrorCode.AI_TIMEOUT,
]);

/**
 * Domain error codes that are DELIBERATE, deterministic request outcomes and
 * therefore must NEVER be degraded — retrying/substituting cannot change them
 * and hiding them would mask a real client/security problem.
 */
export const CRITICAL_DOMAIN_ERROR_CODES: ReadonlySet<string> = new Set([
  ErrorCode.VALIDATION,
  ErrorCode.NOT_FOUND,
  ErrorCode.CONFLICT,
  ErrorCode.UNAUTHORIZED,
  ErrorCode.FORBIDDEN,
  ErrorCode.BUSINESS_RULE,
  ErrorCode.RATE_LIMITED,
]);

/**
 * The default {@link DegradePredicate} for {@link withFallback}: degrade ONLY on
 * the narrow set of transient/unavailable {@link DEGRADABLE_ERROR_CODES}
 * (circuit-open, AI-unavailable, AI-timeout). Every other error — including all
 * other {@link DomainError}s (validation, forbidden, not-found, …) AND opaque
 * non-domain errors — is re-thrown. Use this when a fallback should only kick in
 * for a KNOWN-degradable dependency (e.g. the AI endpoints), so a genuine bug
 * still surfaces as an error rather than being silently swallowed.
 */
export const isDegradableError: DegradePredicate = (error: unknown): boolean =>
  error instanceof DomainError && DEGRADABLE_ERROR_CODES.has(error.code);

/**
 * A BROADER {@link DegradePredicate} suited to serve-stale-on-error READ paths
 * ({@link staleOnError}): degrade on anything EXCEPT a deliberate domain refusal
 * ({@link CRITICAL_DOMAIN_ERROR_CODES} — validation/not-found/forbidden/…).
 *
 * The reasoning mirrors {@link import('./retry.js').defaultShouldRetry}: a
 * transient infrastructure failure (a dropped DB connection, a cache outage)
 * usually surfaces as an opaque `Error` with no domain `code`, and for a
 * non-critical read that is exactly when serving the last-known-good value is
 * the right call. Deterministic domain errors (a genuinely missing entity → 404,
 * a forbidden read → 403) still surface unchanged.
 */
export const isNonCriticalError: DegradePredicate = (error: unknown): boolean => {
  if (error instanceof DomainError) {
    return !CRITICAL_DOMAIN_ERROR_CODES.has(error.code);
  }
  // No domain code: an opaque infrastructure failure — safe to degrade a
  // non-critical read to its cached value.
  return true;
};

/* -------------------------------------------------------------------------- */
/* withFallback                                                               */
/* -------------------------------------------------------------------------- */

/** Options controlling {@link withFallback}. All optional. */
export interface WithFallbackOptions {
  /**
   * Human-readable label of the feature being protected (e.g. `'ai:query'`,
   * `'tenant-branding'`), included in the structured degradation log for
   * correlation. Defaults to `'unknown'`.
   */
  readonly feature?: string;
  /**
   * Gate deciding whether a given error is eligible for degradation. Defaults to
   * {@link isDegradableError} (transient/unavailable only) so deliberate domain
   * errors still surface.
   */
  readonly shouldDegrade?: DegradePredicate;
  /** Injectable logger for the `event: 'degraded'` line. Defaults to a no-op. */
  readonly logger?: DegradationLogger;
}

/** A logger that discards everything — the default so degradation is silent unless observed. */
const NOOP_LOGGER: DegradationLogger = { info: (): void => undefined };

/**
 * Runs `primary` and, if it fails with a DEGRADABLE error, returns the value
 * produced by `fallback` instead of throwing (Requirements 20.5, 27.7).
 *
 * Control flow:
 * 1. `await primary()` — on success its value is returned unchanged.
 * 2. On failure, {@link WithFallbackOptions.shouldDegrade} inspects the error:
 *    - returns `false` → the original error is RE-THROWN untouched (deliberate
 *      domain outcomes like validation/forbidden always surface);
 *    - returns `true` → a structured `event: 'degraded'` line is logged and
 *      `fallback(error)` is awaited and returned.
 *
 * The combinator itself never throws for a degradable error when a fallback is
 * supplied; only the fallback throwing (e.g. no cached value to serve) or a
 * non-degradable error propagates.
 *
 * @typeParam T - The resolved value type shared by `primary` and `fallback`.
 * @param primary - The primary operation to attempt.
 * @param fallback - Produces the substitute value from the degrading error. May
 *   be sync or async.
 * @param options - See {@link WithFallbackOptions}.
 * @returns The primary value, or the fallback value when degrading.
 *
 * @example
 * ```ts
 * // AI endpoint: degrade an unavailable/timed-out assistant to a friendly body.
 * const result = await withFallback(
 *   () => salesAssistant.chat(request),
 *   () => ({ reply: 'The AI assistant is temporarily unavailable.', degraded: true }),
 *   { feature: 'ai:sales-assistant', logger },
 * );
 * ```
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: (error: unknown) => Promise<T> | T,
  options: WithFallbackOptions = {},
): Promise<T> {
  const shouldDegrade = options.shouldDegrade ?? isDegradableError;
  const logger = options.logger ?? NOOP_LOGGER;
  const feature = options.feature ?? 'unknown';

  try {
    return await primary();
  } catch (error) {
    if (!shouldDegrade(error)) {
      throw error;
    }
    logger.info('feature degraded to fallback', {
      event: 'degraded',
      feature,
      reason: describeError(error),
    });
    return fallback(error);
  }
}

/* -------------------------------------------------------------------------- */
/* staleOnError (cache-first-with-fallback)                                   */
/* -------------------------------------------------------------------------- */

/**
 * The minimal cache surface {@link staleOnError} needs. Structurally compatible
 * with the application `ICache` port (so any `ICache` can be passed) WITHOUT the
 * resilience layer taking a dependency on the application layer.
 */
export interface DegradationCache {
  /** Returns the cached value for `key`, or `null` when absent/expired. */
  get<T>(key: string): Promise<T | null>;
  /** Stores `value` under `key`, optionally with a TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
}

/** Options controlling {@link staleOnError}. */
export interface StaleOnErrorOptions {
  /** Feature label for the degradation log (e.g. `'tenant-branding'`). */
  readonly feature?: string;
  /**
   * TTL (seconds) applied when refreshing the stale snapshot after a successful
   * live load. Omit for a non-expiring last-known-good snapshot (staleness then
   * bounded only by explicit invalidation on write).
   */
  readonly ttlSeconds?: number;
  /**
   * Gate deciding whether a live-load failure is eligible for serving stale.
   * Defaults to {@link isNonCriticalError} (degrade on transient/opaque failures
   * but never on a deliberate domain refusal such as not-found/forbidden).
   */
  readonly shouldDegrade?: DegradePredicate;
  /** Injectable logger for the `event: 'degraded'` line. Defaults to a no-op. */
  readonly logger?: DegradationLogger;
}

/**
 * STALE-WHILE-DEGRADED read helper (Requirement 27.7): attempts a live load and,
 * on a degradable failure, serves the last-known-good value from `cache` instead
 * of failing the request.
 *
 * This is the complement to a cache-aside hit path: use it for the MISS branch
 * (or any read where freshness is preferred but a brief staleness beats an
 * error). Flow:
 * 1. `await load()` — on success the value is written back to `key` (best-effort,
 *    never fatal) so a FUTURE failure has something to serve, and returned.
 * 2. On failure, {@link StaleOnErrorOptions.shouldDegrade} decides:
 *    - `false` → re-throw (a genuinely missing/forbidden resource still errors);
 *    - `true` → read `key`; if a snapshot exists, log `event: 'degraded'` and
 *      return it. If there is NO cached value, the original error is re-thrown —
 *      degradation cannot invent data.
 *
 * Only ever apply this to a NON-CRITICAL read (see the module classification):
 * serving stale auth/financial/stock data is NEVER acceptable. The `key` MUST be
 * tenant-scoped by the caller so one tenant can never receive another tenant's
 * cached value (tenant isolation, Requirement 1.5).
 *
 * @typeParam T - The resolved value type.
 * @param cache - The store holding the last-known-good snapshot.
 * @param key - The tenant-scoped snapshot key.
 * @param load - Loads the fresh value from the source of truth.
 * @param options - See {@link StaleOnErrorOptions}.
 * @returns The fresh value, or the stale cached value when degrading.
 */
export async function staleOnError<T>(
  cache: DegradationCache,
  key: string,
  load: () => Promise<T>,
  options: StaleOnErrorOptions = {},
): Promise<T> {
  const shouldDegrade = options.shouldDegrade ?? isNonCriticalError;
  const logger = options.logger ?? NOOP_LOGGER;
  const feature = options.feature ?? 'unknown';

  try {
    const fresh = await load();
    try {
      await cache.set(key, fresh, options.ttlSeconds);
    } catch {
      // Refreshing the snapshot is best-effort; the correct value is in hand.
    }
    return fresh;
  } catch (error) {
    if (!shouldDegrade(error)) {
      throw error;
    }
    let cached: T | null = null;
    try {
      cached = await cache.get<T>(key);
    } catch {
      cached = null;
    }
    if (cached !== null) {
      logger.info('served stale cached value after live failure', {
        event: 'degraded',
        feature,
        reason: describeError(error),
        stale: true,
      });
      return cached;
    }
    // Nothing cached to serve — degradation cannot fabricate data, so surface.
    throw error;
  }
}

/** Extracts a concise, log-safe reason string from an unknown error. */
function describeError(error: unknown): string {
  if (error instanceof DomainError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
