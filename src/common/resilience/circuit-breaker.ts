import { DomainError, ErrorCode } from '@domain/errors/index.js';

/**
 * Resilience layer — CIRCUIT BREAKER (task 41.2, Requirement 27.3).
 *
 * ## What this is
 * {@link CircuitBreaker} is a generic, dependency-free implementation of the
 * circuit-breaker stability pattern. It wraps any async operation
 * (`() => Promise<T>`) and protects a flaky downstream dependency — an external
 * plugin integration, an AI provider, an outbound HTTP call — by tracking
 * consecutive failures and, once a threshold is crossed, "tripping" so that
 * subsequent calls fail FAST without touching the ailing dependency. This is the
 * resilience half of Requirement 27.3 ("WHEN a downstream service fails, THE
 * Backend_Service SHALL implement circuit breaker pattern with 5 failure
 * threshold"); retry-with-backoff (task 41.3) is the complementary policy that
 * composes AROUND this one.
 *
 * ## The three states (classic breaker)
 * - **CLOSED** — the healthy state. Calls pass through to the wrapped
 *   operation. Each success resets the consecutive-failure counter; each failure
 *   increments it. When the counter reaches {@link CircuitBreakerOptions.failureThreshold}
 *   (default **5**) the breaker trips to OPEN.
 * - **OPEN** — the tripped state. Calls are rejected IMMEDIATELY with a
 *   {@link CircuitOpenError} without invoking the operation, sparing the failing
 *   dependency and giving the caller a fast, typed signal. After
 *   {@link CircuitBreakerOptions.resetTimeoutMs} elapses the breaker moves to
 *   HALF_OPEN to probe recovery.
 * - **HALF_OPEN** — the recovery-probe state. A LIMITED number of trial calls
 *   ({@link CircuitBreakerOptions.halfOpenMaxCalls}) are allowed through;
 *   additional concurrent calls are rejected fast. Reaching
 *   {@link CircuitBreakerOptions.successThreshold} consecutive successes closes
 *   the breaker (recovery); a single failure re-opens it and restarts the
 *   cooldown.
 *
 * ## Determinism (testability)
 * Time is read through an injectable {@link CircuitBreakerClock} (milliseconds),
 * mirroring the AI layer's injectable `AIClock`/`AITimer`
 * (`src/ai/resilient-ai-service.ts`). The OPEN → HALF_OPEN transition is
 * evaluated lazily on the next {@link CircuitBreaker.execute} call by comparing
 * the injected clock to when the breaker opened, so tests drive recovery by
 * advancing a fake clock with NO real waiting.
 *
 * ## Applying it to plugins and AI services (Requirement 27.3)
 * The breaker is intentionally generic and COMPOSABLE rather than wired into any
 * one caller:
 * - **AI services** — {@link import('../../ai/circuit-breaker-ai-provider.js').CircuitBreakerAIProvider}
 *   decorates an {@link import('../../ai/ai-provider.js').AIProvider} by running
 *   each `complete` call through a {@link CircuitBreaker}. It slots into the
 *   existing `ResilientAIService` provider list without changing that wrapper,
 *   exactly as `ai-provider.ts` anticipates.
 * - **Plugin integrations** — an integration adapter (the `PluginLoader` /
 *   external-integration seam in `src/plugins/`) wraps each outbound call the
 *   same way: `breaker.execute(() => integration.call(...))`. One breaker per
 *   dependency isolates failures so one sick provider can't exhaust resources
 *   shared with healthy ones.
 */

/* -------------------------------------------------------------------------- */
/* State + error                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The three states of a {@link CircuitBreaker}. Modelled as a closed string
 * union (const object) so it is safe to expose on metrics/log lines and to
 * switch over exhaustively.
 */
export const CircuitState = {
  /** Healthy: calls pass through; failures are counted. */
  Closed: 'closed',
  /** Tripped: calls are rejected fast until the cooldown elapses. */
  Open: 'open',
  /** Probing recovery: a limited number of trial calls are allowed through. */
  HalfOpen: 'half_open',
} as const;

/** Union of all valid {@link CircuitState} values. */
export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];

/**
 * Injectable monotonic-ish clock returning milliseconds (e.g. `Date.now`), used
 * to time the OPEN → HALF_OPEN cooldown. Injectable so tests advance time
 * deterministically without real waiting (mirrors the AI layer's `AIClock`).
 */
export type CircuitBreakerClock = () => number;

/**
 * Raised when a call is rejected because the protecting {@link CircuitBreaker}
 * is OPEN (or the HALF_OPEN probe budget is exhausted). Extends the domain
 * {@link DomainError} hierarchy so outer layers translate it into a transport
 * response like any other domain error — carrying {@link ErrorCode.SERVICE_UNAVAILABLE}
 * and mapping to HTTP 503 Service Unavailable. The wrapped operation is NEVER
 * invoked when this is thrown, which is the whole point: the caller learns fast
 * that the dependency is being given room to recover (Requirement 27.3).
 */
export class CircuitOpenError extends DomainError {
  public readonly code = ErrorCode.SERVICE_UNAVAILABLE;
  public readonly httpStatus = 503;

  /**
   * @param message - Human-readable description; defaults to a generic message.
   * @param details - Optional structured context (e.g. breaker `name`, `state`,
   *   time remaining until the next recovery probe) for logging/correlation.
   */
  constructor(
    message = 'Circuit breaker is open; dependency is temporarily unavailable',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/* -------------------------------------------------------------------------- */
/* Options + metrics                                                          */
/* -------------------------------------------------------------------------- */

/** Configuration for a {@link CircuitBreaker}. All fields optional (sensible defaults). */
export interface CircuitBreakerOptions {
  /**
   * Consecutive failures in CLOSED that trip the breaker to OPEN. Requirement
   * 27.3 mandates a threshold of **5**, which is the default. Must be a positive
   * integer.
   */
  readonly failureThreshold?: number;
  /**
   * Consecutive successes in HALF_OPEN required to CLOSE the breaker (declare
   * recovery). Defaults to **1**. Must be a positive integer.
   */
  readonly successThreshold?: number;
  /**
   * Cooldown in milliseconds the breaker stays OPEN before allowing a HALF_OPEN
   * recovery probe. Defaults to **30_000** (30s). Must be a positive integer.
   */
  readonly resetTimeoutMs?: number;
  /**
   * Maximum number of concurrent trial calls allowed through while HALF_OPEN;
   * additional calls are rejected fast with {@link CircuitOpenError}. Defaults
   * to {@link CircuitBreakerOptions.successThreshold}. Must be a positive integer.
   */
  readonly halfOpenMaxCalls?: number;
  /**
   * Optional label used in {@link CircuitOpenError} details and metrics to
   * identify which dependency this breaker guards (e.g. `'ai:openai'`).
   */
  readonly name?: string;
  /**
   * Injectable clock (milliseconds); defaults to {@link Date.now}. Provide a
   * fake clock in tests for deterministic cooldown behaviour.
   */
  readonly clock?: CircuitBreakerClock;
  /**
   * Optional predicate deciding whether a thrown error counts as a failure that
   * should trip the breaker. Return `false` to treat an error as "not the
   * dependency's fault" (e.g. a validation error) so it is rethrown WITHOUT
   * affecting breaker state. Defaults to counting every error as a failure.
   */
  readonly isFailure?: (error: unknown) => boolean;
}

/**
 * A point-in-time snapshot of a {@link CircuitBreaker} for observability
 * (metrics/health/log lines). All counters are cumulative for the breaker's
 * lifetime except {@link CircuitBreakerMetrics.consecutiveFailures} /
 * {@link CircuitBreakerMetrics.consecutiveSuccesses}, which reset on state
 * transitions.
 */
export interface CircuitBreakerMetrics {
  /** The breaker's label, when one was configured. */
  readonly name?: string;
  /** The current logical state. */
  readonly state: CircuitState;
  /** Consecutive failures observed in the current CLOSED streak. */
  readonly consecutiveFailures: number;
  /** Consecutive successes observed in the current HALF_OPEN probe streak. */
  readonly consecutiveSuccesses: number;
  /** Total calls that reached the wrapped operation (excludes fast rejects). */
  readonly totalCalls: number;
  /** Total wrapped-operation successes. */
  readonly totalSuccesses: number;
  /** Total wrapped-operation failures (per the {@link CircuitBreakerOptions.isFailure} predicate). */
  readonly totalFailures: number;
  /** Total calls rejected fast because the breaker was OPEN / probe budget exhausted. */
  readonly rejectedCalls: number;
  /** Epoch-ms the breaker last transitioned to OPEN, or `undefined` if never. */
  readonly openedAt?: number;
  /** Epoch-ms of the last wrapped-operation failure, or `undefined` if never. */
  readonly lastFailureAt?: number;
}

/* -------------------------------------------------------------------------- */
/* CircuitBreaker                                                             */
/* -------------------------------------------------------------------------- */

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_SUCCESS_THRESHOLD = 1;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;

/**
 * Generic async circuit breaker. See the module doc-comment for the full
 * contract, states and how it is applied to AI providers and plugin
 * integrations (Requirement 27.3).
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly name: string | undefined;
  private readonly clock: CircuitBreakerClock;
  private readonly isFailure: (error: unknown) => boolean;

  private currentState: CircuitState = CircuitState.Closed;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  /** In-flight HALF_OPEN probe calls, bounded by {@link halfOpenMaxCalls}. */
  private halfOpenInFlight = 0;

  private totalCalls = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private rejectedCalls = 0;
  private openedAt: number | undefined;
  private lastFailureAt: number | undefined;

  constructor(options: CircuitBreakerOptions = {}) {
    const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    const successThreshold = options.successThreshold ?? DEFAULT_SUCCESS_THRESHOLD;
    const resetTimeoutMs = options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    const halfOpenMaxCalls = options.halfOpenMaxCalls ?? successThreshold;

    if (!Number.isInteger(failureThreshold) || failureThreshold <= 0) {
      throw new Error('CircuitBreaker failureThreshold must be a positive integer');
    }
    if (!Number.isInteger(successThreshold) || successThreshold <= 0) {
      throw new Error('CircuitBreaker successThreshold must be a positive integer');
    }
    if (!Number.isInteger(resetTimeoutMs) || resetTimeoutMs <= 0) {
      throw new Error('CircuitBreaker resetTimeoutMs must be a positive integer');
    }
    if (!Number.isInteger(halfOpenMaxCalls) || halfOpenMaxCalls <= 0) {
      throw new Error('CircuitBreaker halfOpenMaxCalls must be a positive integer');
    }

    this.failureThreshold = failureThreshold;
    this.successThreshold = successThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
    this.name = options.name;
    this.clock = options.clock ?? ((): number => Date.now());
    this.isFailure = options.isFailure ?? ((): boolean => true);
  }

  /**
   * The current logical state. Reflects a due OPEN → HALF_OPEN transition: once
   * the cooldown has elapsed this reports {@link CircuitState.HalfOpen} even
   * before the next {@link execute}, so health/metrics readers see the breaker
   * is ready to probe. The read is side-effect-free; the actual transition is
   * committed by the next {@link execute}.
   */
  public get state(): CircuitState {
    if (this.currentState === CircuitState.Open && this.cooldownElapsed()) {
      return CircuitState.HalfOpen;
    }
    return this.currentState;
  }

  /**
   * Runs `fn` under the breaker's protection.
   *
   * - **CLOSED / HALF_OPEN (within probe budget):** invokes `fn`; a success or
   *   failure updates the breaker state per the configured thresholds and the
   *   original result/error is returned/rethrown transparently.
   * - **OPEN (cooldown not elapsed) / HALF_OPEN (probe budget exhausted):**
   *   rejects immediately with {@link CircuitOpenError} WITHOUT invoking `fn`.
   *
   * @typeParam T - The resolved type of the wrapped operation.
   * @param fn - The async operation to protect. Invoked at most once per call.
   * @throws {CircuitOpenError} When the breaker is OPEN or the HALF_OPEN probe
   *   budget is exhausted.
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Commit a due OPEN → HALF_OPEN transition before deciding admission.
    if (this.currentState === CircuitState.Open && this.cooldownElapsed()) {
      this.toHalfOpen();
    }

    if (this.currentState === CircuitState.Open) {
      this.rejectedCalls += 1;
      throw this.openError();
    }

    let admittedProbe = false;
    if (this.currentState === CircuitState.HalfOpen) {
      if (this.halfOpenInFlight >= this.halfOpenMaxCalls) {
        this.rejectedCalls += 1;
        throw this.openError('Circuit breaker is half-open; recovery-probe budget exhausted');
      }
      this.halfOpenInFlight += 1;
      admittedProbe = true;
    }

    this.totalCalls += 1;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onError(error);
      throw error;
    } finally {
      if (admittedProbe) {
        // Release the probe slot we reserved. A state transition (toOpen /
        // toHalfOpen) may already have zeroed the counter, so clamp at 0.
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      }
    }
  }

  /**
   * Returns a point-in-time {@link CircuitBreakerMetrics} snapshot for
   * observability. The returned object is a plain copy and safe to log/serialize.
   */
  public getMetrics(): CircuitBreakerMetrics {
    const metrics: {
      -readonly [K in keyof CircuitBreakerMetrics]: CircuitBreakerMetrics[K];
    } = {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      rejectedCalls: this.rejectedCalls,
    };
    if (this.name !== undefined) {
      metrics.name = this.name;
    }
    if (this.openedAt !== undefined) {
      metrics.openedAt = this.openedAt;
    }
    if (this.lastFailureAt !== undefined) {
      metrics.lastFailureAt = this.lastFailureAt;
    }
    return metrics;
  }

  /**
   * Force-resets the breaker to CLOSED and clears the streak counters (cumulative
   * lifetime totals are preserved). Useful for administrative recovery or test
   * setup; normal recovery happens automatically via the HALF_OPEN probe.
   */
  public reset(): void {
    this.currentState = CircuitState.Closed;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
    this.openedAt = undefined;
  }

  /** Whether the OPEN cooldown has elapsed and a recovery probe is due. */
  private cooldownElapsed(): boolean {
    if (this.openedAt === undefined) {
      return false;
    }
    return this.clock() - this.openedAt >= this.resetTimeoutMs;
  }

  /** Records a successful wrapped-operation call and advances state. */
  private onSuccess(): void {
    this.totalSuccesses += 1;
    if (this.currentState === CircuitState.HalfOpen) {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.toClosed();
      }
      return;
    }
    // CLOSED: a success clears any accumulated consecutive failures.
    this.consecutiveFailures = 0;
  }

  /** Records a wrapped-operation error and advances state (per {@link isFailure}). */
  private onError(error: unknown): void {
    if (!this.isFailure(error)) {
      // Not counted against the breaker; leave state/counters untouched.
      return;
    }
    this.totalFailures += 1;
    this.lastFailureAt = this.clock();

    if (this.currentState === CircuitState.HalfOpen) {
      // A failed probe re-opens the breaker and restarts the cooldown.
      this.toOpen();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.toOpen();
    }
  }

  private toOpen(): void {
    this.currentState = CircuitState.Open;
    this.openedAt = this.clock();
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
  }

  private toHalfOpen(): void {
    this.currentState = CircuitState.HalfOpen;
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
  }

  private toClosed(): void {
    this.currentState = CircuitState.Closed;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openedAt = undefined;
  }

  /** Builds a {@link CircuitOpenError} with breaker context in its details. */
  private openError(message?: string): CircuitOpenError {
    const details: Record<string, unknown> = { state: this.currentState };
    if (this.name !== undefined) {
      details.name = this.name;
    }
    if (this.openedAt !== undefined) {
      const remaining = this.openedAt + this.resetTimeoutMs - this.clock();
      details.retryAfterMs = Math.max(0, remaining);
    }
    return message !== undefined
      ? new CircuitOpenError(message, details)
      : new CircuitOpenError(undefined, details);
  }
}
