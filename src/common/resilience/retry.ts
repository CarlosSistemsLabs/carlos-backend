import { DomainError } from '@domain/errors/index.js';

/**
 * Resilience — RETRY WITH EXPONENTIAL BACKOFF (task 41.3, Requirement 27.4).
 *
 * This module provides a single generic {@link retry} combinator plus two thin,
 * documented presets ({@link retryDatabaseOperation}, {@link retryExternalCall})
 * for the two call sites the requirement calls out: database operations and
 * outbound external-service calls (the AI provider seam / plugin integrations).
 *
 * ## Design goals
 * - **Transient-only:** retries are gated by a {@link ShouldRetryPredicate} so
 *   only transient/retryable failures (dropped connections, pool timeouts, 5xx)
 *   are retried; deterministic domain errors ({@link import('@domain/errors/index.js').ValidationError},
 *   {@link import('@domain/errors/index.js').NotFoundError}, …) fail FAST and are
 *   re-thrown on the first attempt.
 * - **Exponential backoff:** the delay before retry N grows geometrically
 *   (`baseDelayMs * multiplier^(N-1)`), capped by an optional `maxDelayMs`, with
 *   optional jitter to avoid a thundering herd of synchronized retries.
 * - **Deterministic tests:** the sleep is INJECTABLE ({@link SleepFn}), mirroring
 *   how {@link import('../../ai/resilient-ai-service.js').ResilientAIService}
 *   injects its timer. Tests pass a fake `sleep` that records delays and resolves
 *   immediately, so there are NO real multi-second waits.
 * - **Error fidelity:** after the attempt budget is exhausted the LAST error is
 *   re-thrown unchanged (never wrapped in a way that hides it). A non-enumerable
 *   {@link RETRY_ATTEMPTS_SYMBOL} marker is best-effort attached to Error objects
 *   recording how many attempts were made, for diagnostics.
 */

/**
 * Predicate deciding whether a failed operation should be retried.
 *
 * @param error - The error thrown by the most recent attempt.
 * @param attempt - The 1-based number of the attempt that just failed (the
 *   first attempt is `1`).
 * @returns `true` to schedule another attempt (subject to the attempt budget),
 *   `false` to re-throw the error immediately.
 */
export type ShouldRetryPredicate = (error: unknown, attempt: number) => boolean;

/**
 * Injectable async sleep. The default {@link systemSleep} delegates to
 * `setTimeout`; tests pass a fake that records the requested delays and resolves
 * synchronously so no real time elapses.
 *
 * @param ms - The number of milliseconds to wait before resolving.
 */
export type SleepFn = (ms: number) => Promise<void>;

/** Injectable source of randomness in `[0, 1)` used to compute jitter. */
export type RandomFn = () => number;

/** Default {@link SleepFn} backed by the host `setTimeout`. */
export const systemSleep: SleepFn = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The default number of attempts: the initial try plus 2 retries. The
 * requirement (27.4) speaks of "3 retry attempts"; we interpret and implement
 * that as **3 total attempts** (1 initial call + 2 retries). Callers who want a
 * strict "1 + 3" budget can pass `attempts: 4`.
 */
export const DEFAULT_ATTEMPTS = 3 as const;

/** Default base delay before the first retry, in milliseconds. */
export const DEFAULT_BASE_DELAY_MS = 100 as const;

/** Default geometric growth factor applied to the delay after each retry. */
export const DEFAULT_BACKOFF_MULTIPLIER = 2 as const;

/**
 * Options controlling a {@link retry} invocation. Every field is optional; the
 * defaults implement Requirement 27.4 (3 attempts, exponential backoff).
 */
export interface RetryOptions {
  /**
   * Total number of attempts, INCLUDING the initial call. Defaults to
   * {@link DEFAULT_ATTEMPTS} (3). Values below 1 are clamped to 1 (always at
   * least one attempt). A value of 1 disables retrying.
   */
  readonly attempts?: number;
  /**
   * Base delay (ms) applied before the FIRST retry. Subsequent retries scale
   * this geometrically. Defaults to {@link DEFAULT_BASE_DELAY_MS}.
   */
  readonly baseDelayMs?: number;
  /**
   * Geometric growth factor: the delay before retry N is
   * `baseDelayMs * multiplier^(N-1)`. Defaults to
   * {@link DEFAULT_BACKOFF_MULTIPLIER} (2), i.e. the classic doubling backoff.
   */
  readonly multiplier?: number;
  /**
   * Optional upper bound (ms) on the computed backoff delay. When set, no single
   * wait exceeds this cap regardless of the exponential schedule. Undefined
   * means uncapped.
   */
  readonly maxDelayMs?: number;
  /**
   * Fractional jitter in `[0, 1]` applied to each delay to de-synchronize
   * retries across callers (a "thundering herd" guard). `0` (the default)
   * disables jitter for fully deterministic delays. A value of `j` scales each
   * delay by a random factor in `[1 - j, 1 + j)` (post-cap the result is still
   * clamped to `maxDelayMs`).
   */
  readonly jitter?: number;
  /**
   * Predicate gating retries. Defaults to {@link defaultShouldRetry}, which
   * retries transient infrastructure errors but NOT deterministic
   * {@link DomainError}s (validation/not-found/etc.).
   */
  readonly shouldRetry?: ShouldRetryPredicate;
  /** Injectable sleep for deterministic tests. Defaults to {@link systemSleep}. */
  readonly sleep?: SleepFn;
  /**
   * Injectable randomness for jitter. Defaults to `Math.random`. Only consulted
   * when `jitter > 0`.
   */
  readonly random?: RandomFn;
  /**
   * Optional observer invoked just before each backoff wait. Useful for logging
   * or metrics. Receives the error, the 1-based attempt that failed, and the
   * delay (ms) about to be awaited. Never affects control flow; exceptions from
   * it propagate to the caller, so keep it side-effect-light.
   */
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * A non-enumerable marker key attached (best-effort) to a thrown `Error` after
 * the retry budget is exhausted, recording how many attempts were made. It does
 * not replace or hide the original error; it is purely diagnostic.
 */
export const RETRY_ATTEMPTS_SYMBOL: unique symbol = Symbol('carlos.retry.attempts');

/**
 * Reads the attempt count attached to an error by {@link retry}, if present.
 *
 * @param error - The error to inspect.
 * @returns The number of attempts made before this error was thrown, or
 *   `undefined` if the error carries no marker.
 */
export function getRetryAttempts(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && RETRY_ATTEMPTS_SYMBOL in error) {
    const value = (error as Record<symbol, unknown>)[RETRY_ATTEMPTS_SYMBOL];
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

/**
 * Set of lowercased `error.code` values (Node network stack + Prisma transient
 * connection/timeout codes) treated as retryable by {@link defaultShouldRetry}.
 * Kept as string codes so this module takes NO hard dependency on Prisma or
 * Node's `net` typings; error objects are inspected structurally.
 *
 * - Node network: `econnreset`, `econnrefused`, `etimedout`, `epipe`, `enotfound`,
 *   `eai_again`, `ehostunreach`, `enetunreach`, `esockettimedout`.
 * - Prisma: `p1001` (can't reach DB), `p1002` (DB timeout), `p1008` (op timeout),
 *   `p1017` (server closed connection), `p2024` (connection-pool timeout),
 *   `p2028` (transaction API error, often transient).
 */
export const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'econnreset',
  'econnrefused',
  'etimedout',
  'esockettimedout',
  'epipe',
  'enotfound',
  'eai_again',
  'ehostunreach',
  'enetunreach',
  'p1001',
  'p1002',
  'p1008',
  'p1017',
  'p2024',
  'p2028',
]);

/**
 * Extracts a lowercased string `code` from an unknown error, if it exposes one.
 * Prisma errors and Node system errors both carry a `code` string.
 */
function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code.toLowerCase();
    }
  }
  return undefined;
}

/**
 * The default {@link ShouldRetryPredicate}: a conservative, general-purpose
 * policy suitable for most call sites.
 *
 * Retries when the error looks TRANSIENT and fails fast otherwise:
 * - **Never retries** {@link DomainError}s. These are deterministic outcomes of
 *   the request (validation failures, not-found, conflicts, business-rule
 *   violations); retrying cannot change them and would only add latency.
 * - **Retries** errors carrying a known transient `code`
 *   ({@link TRANSIENT_ERROR_CODES}) — dropped/refused connections, DNS blips,
 *   Prisma connection/pool timeouts.
 * - **Retries** unknown/opaque errors (no `code`, not a {@link DomainError}) by
 *   default, since a bare `Error` from an infrastructure client is more likely
 *   transient than a deliberate domain signal. Callers wanting stricter behavior
 *   should pass their own predicate.
 *
 * @param error - The error thrown by the failed attempt.
 * @returns `true` if the operation should be retried.
 */
export const defaultShouldRetry: ShouldRetryPredicate = (error: unknown): boolean => {
  if (error instanceof DomainError) {
    return false;
  }
  const code = errorCode(error);
  if (code !== undefined) {
    return TRANSIENT_ERROR_CODES.has(code);
  }
  // No structured code and not a domain error: assume transient infrastructure
  // failure and allow a retry.
  return true;
};

/**
 * Computes the backoff delay (ms) to wait BEFORE a given retry.
 *
 * @param retryIndex - The 0-based retry index (0 = the first retry, before the
 *   2nd attempt).
 * @param options - Resolved delay parameters.
 * @returns The delay in milliseconds, capped by `maxDelayMs` and adjusted by
 *   jitter when enabled. Never negative.
 */
export function computeBackoffDelay(
  retryIndex: number,
  options: {
    readonly baseDelayMs: number;
    readonly multiplier: number;
    readonly maxDelayMs?: number;
    readonly jitter: number;
    readonly random: RandomFn;
  },
): number {
  const raw = options.baseDelayMs * Math.pow(options.multiplier, retryIndex);
  const capped = options.maxDelayMs !== undefined ? Math.min(raw, options.maxDelayMs) : raw;
  if (options.jitter <= 0) {
    return Math.max(0, capped);
  }
  // Scale by a random factor in [1 - jitter, 1 + jitter).
  const factor = 1 - options.jitter + options.random() * (2 * options.jitter);
  const jittered = capped * factor;
  const bounded = options.maxDelayMs !== undefined ? Math.min(jittered, options.maxDelayMs) : jittered;
  return Math.max(0, bounded);
}

/**
 * Runs `fn`, retrying transient failures with exponential backoff until it
 * succeeds or the attempt budget is exhausted (Requirement 27.4).
 *
 * On success the resolved value is returned. When every attempt fails, the LAST
 * error is re-thrown unchanged (a diagnostic {@link RETRY_ATTEMPTS_SYMBOL}
 * marker is attached best-effort). Retries only happen while
 * {@link RetryOptions.shouldRetry} returns `true`; otherwise the error is
 * re-thrown immediately without any wait.
 *
 * @typeParam T - The operation's resolved value type.
 * @param fn - The async operation to run. Invoked once per attempt.
 * @param options - Backoff/retry configuration; see {@link RetryOptions}.
 * @returns The value resolved by the first successful attempt.
 * @throws The last error thrown by `fn` once retries are exhausted or when
 *   `shouldRetry` declines to retry.
 *
 * @example
 * ```ts
 * // Wrap a repository read; only transient DB errors are retried.
 * const plan = await retry(() => repo.findById(id));
 * ```
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? DEFAULT_ATTEMPTS));
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const multiplier = options.multiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const jitter = options.jitter ?? 0;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const sleep = options.sleep ?? systemSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === attempts;
      if (isLastAttempt || !shouldRetry(error, attempt)) {
        throw markAttempts(error, attempt);
      }
      const delayMs = computeBackoffDelay(attempt - 1, {
        baseDelayMs,
        multiplier,
        ...(options.maxDelayMs !== undefined ? { maxDelayMs: options.maxDelayMs } : {}),
        jitter,
        random,
      });
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  // Unreachable in practice (the loop returns or throws), but satisfies the
  // type checker and guards against an `attempts` of 0 slipping through.
  throw markAttempts(lastError, attempts);
}

/**
 * Attaches the diagnostic attempt count to an `Error` without mutating its
 * message/stack or hiding it. Non-Error throwables are returned unchanged.
 */
function markAttempts(error: unknown, attempts: number): unknown {
  if (error instanceof Error) {
    Object.defineProperty(error, RETRY_ATTEMPTS_SYMBOL, {
      value: attempts,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return error;
}

/**
 * DB-oriented preset (Requirement 27.4): {@link retry} tuned for database
 * operations — 3 attempts with exponential backoff and a default
 * {@link ShouldRetryPredicate} targeting transient Prisma connection/pool
 * timeouts (see {@link TRANSIENT_ERROR_CODES}) while never retrying deterministic
 * {@link DomainError}s.
 *
 * A repository can wrap any single call with it, e.g.:
 * ```ts
 * async findById(id: UUID): Promise<Plan | null> {
 *   return retryDatabaseOperation(() =>
 *     this.prisma.plan.findUnique({ where: { id } }).then((r) => (r ? toDomain(r) : null)),
 *   );
 * }
 * ```
 * Overrides are shallow-merged, so callers can tune `baseDelayMs`/`attempts` or
 * inject a fake `sleep` in tests while keeping the DB-aware `shouldRetry`.
 *
 * @typeParam T - The operation's resolved value type.
 * @param fn - The database operation to run.
 * @param overrides - Optional {@link RetryOptions} overrides.
 * @returns The value resolved by the first successful attempt.
 */
export function retryDatabaseOperation<T>(
  fn: () => Promise<T>,
  overrides: RetryOptions = {},
): Promise<T> {
  return retry(fn, {
    attempts: DEFAULT_ATTEMPTS,
    baseDelayMs: DEFAULT_BASE_DELAY_MS,
    multiplier: DEFAULT_BACKOFF_MULTIPLIER,
    shouldRetry: defaultShouldRetry,
    ...overrides,
  });
}

/**
 * External-service preset (Requirement 27.4): {@link retry} tuned for outbound
 * calls to third parties (the AI provider seam, plugin/integration HTTP calls).
 * External dependencies are the flakiest hop, so this preset uses a slightly
 * larger base delay and a `maxDelayMs` cap by default; the transient-error
 * policy ({@link defaultShouldRetry}) still applies.
 *
 * It stays a COMPOSABLE utility: it does not rewire any composition-root
 * defaults. A caller wraps a single outbound call, e.g. an
 * {@link import('../../ai/ai-provider.js').AIProvider} decorator can call
 * `retryExternalCall(() => delegate.complete(request))` around its delegate.
 *
 * @typeParam T - The operation's resolved value type.
 * @param fn - The outbound call to run.
 * @param overrides - Optional {@link RetryOptions} overrides.
 * @returns The value resolved by the first successful attempt.
 */
export function retryExternalCall<T>(
  fn: () => Promise<T>,
  overrides: RetryOptions = {},
): Promise<T> {
  return retry(fn, {
    attempts: DEFAULT_ATTEMPTS,
    baseDelayMs: 200,
    multiplier: DEFAULT_BACKOFF_MULTIPLIER,
    maxDelayMs: 5_000,
    shouldRetry: defaultShouldRetry,
    ...overrides,
  });
}
