import {
  AIOperationKind,
  DEFAULT_AI_TIMEOUTS,
  timeoutForOperation,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIProviderKind,
  type AIRequestContext,
  type AITimeoutConfig,
  type IAIService,
} from './ai-service.js';
import { AITimeoutError, AIUnavailableError } from './ai-errors.js';
import type { AIProvider } from './ai-provider.js';

/**
 * AI Integration Layer — RESILIENT WRAPPER (task 37.2, Requirements 20.2, 20.4,
 * 20.5, 20.6).
 *
 * {@link ResilientAIService} is the concrete {@link IAIService} bound in the
 * composition root. It composes one or more {@link AIProvider}s and adds the
 * cross-cutting resilience the application relies on:
 *
 * - **Timeouts (Requirement 20.4):** every provider call is raced against the
 *   per-operation budget (queries 10s, reports 30s, predictions 60s); on exceed
 *   it throws {@link AITimeoutError}. The timer is INJECTABLE ({@link AITimer})
 *   so tests drive timeouts deterministically without real waiting.
 * - **Provider selection + failover (Requirement 20.2):** an explicit
 *   {@link AICompletionRequest.provider} is tried first, then the remaining
 *   providers in configured order; a failing provider fails over to the next.
 * - **Graceful degradation (Requirement 20.5):** with NO providers configured,
 *   {@link isEnabled} is `false` and {@link complete} throws
 *   {@link AIUnavailableError} so callers SKIP the AI enhancement and continue
 *   the core operation. When all providers fail it throws the most specific
 *   error (timeout if every attempt timed out, otherwise unavailable).
 * - **Cost-tracking logging (Requirement 20.6):** after each interaction it
 *   emits one structured {@link AI_INTERACTION_LOG_EVENT} line (provider, model,
 *   operation kind, token usage, estimated cost, tenant/user/request ids,
 *   latency, outcome). Logging NEVER throws.
 *
 * ## Resilience seam (tasks 41.2 / 41.3)
 * Circuit breaker and retry-with-backoff are NOT implemented yet. They are
 * designed to WRAP each {@link AIProvider.complete} call without churn here: a
 * future decorator can implement {@link AIProvider} over a delegate (adding
 * breaker/retry) and be passed into this wrapper unchanged. The timeout,
 * failover and cost-logging built here compose cleanly around such a decorator.
 */

/** Discriminator emitted in the `event` field of every AI cost-tracking line. */
export const AI_INTERACTION_LOG_EVENT = 'ai_interaction' as const;

/**
 * The structural subset of a logger the cost-tracking sink depends on.
 *
 * Declared locally so the AI layer takes no hard dependency on pino; Fastify's
 * `app.log`/`request.log` and the application root logger satisfy it, mirroring
 * the analytics module's `AnalyticsLogger`.
 */
export interface AIInteractionLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Injectable monotonic-ish clock returning milliseconds (e.g. `Date.now`), used
 * to measure interaction latency. Injectable so tests assert deterministic
 * latencies.
 */
export type AIClock = () => number;

/**
 * Injectable timeout mechanism so the wrapper's timeouts are deterministic and
 * fake-timer-friendly in tests (no real 10s+ waits). The default
 * {@link systemAITimer} delegates to `setTimeout`/`clearTimeout`.
 */
export interface AITimer {
  /**
   * Schedules `fn` to run after `ms` milliseconds and returns a function that
   * cancels the pending callback.
   */
  schedule(fn: () => void, ms: number): () => void;
}

/** Default {@link AITimer} backed by the host `setTimeout`/`clearTimeout`. */
export const systemAITimer: AITimer = {
  schedule(fn: () => void, ms: number): () => void {
    const handle = setTimeout(fn, ms);
    return (): void => {
      clearTimeout(handle);
    };
  },
};

/** The terminal outcome recorded for an interaction on the cost-tracking line. */
export type AIInteractionOutcome = 'success' | 'timeout' | 'unavailable' | 'error';

/** Options for constructing a {@link ResilientAIService}. */
export interface ResilientAIServiceOptions {
  /**
   * The providers to compose, in failover order (Requirement 20.2). An EMPTY
   * list (the default composition) means AI is disabled: {@link IAIService.isEnabled}
   * returns `false` and completions throw {@link AIUnavailableError}
   * (Requirement 20.5).
   */
  readonly providers?: readonly AIProvider[];
  /** Per-operation timeout budget (defaults to {@link DEFAULT_AI_TIMEOUTS}). */
  readonly timeouts?: AITimeoutConfig;
  /** Sink for cost-tracking interaction logs (Requirement 20.6). */
  readonly logger: AIInteractionLogger;
  /** Clock for latency measurement (defaults to `Date.now`). */
  readonly clock?: AIClock;
  /** Timeout mechanism (defaults to {@link systemAITimer}). */
  readonly timer?: AITimer;
}

/**
 * A completion that also carries the {@link AIOperationKind} so the wrapper can
 * select the right timeout budget and attribute the operation on the
 * cost-tracking log. Implemented by {@link ResilientAIService} alongside
 * {@link IAIService}; the capability wrappers (Sales Assistant, NL Query, Report
 * Generation) depend on THIS so their per-operation timeout (10s/30s/60s) is
 * honoured, while generic callers use {@link IAIService.complete} (query budget).
 */
export interface IOperationAwareAIService extends IAIService {
  /**
   * Runs a completion under a specific operation kind's timeout budget
   * (Requirement 20.4) and logs it under that operation kind (Requirement 20.6).
   *
   * @param request - The prompt, tenant context and generation options.
   * @param operationKind - The operation category selecting the timeout budget.
   */
  completeForOperation(
    request: AICompletionRequest,
    operationKind: AIOperationKind,
  ): Promise<AICompletionResponse>;
}

/** Sentinel thrown internally by the timeout race; never escapes the wrapper. */
class TimeoutSignal {
  constructor(readonly provider: AIProviderKind) {}
}

/**
 * Resilient {@link IAIService} composing {@link AIProvider}s with timeouts,
 * failover, graceful degradation and cost-tracking logging. See the module
 * doc-comment for the full contract.
 */
export class ResilientAIService implements IOperationAwareAIService {
  private readonly providers: readonly AIProvider[];
  public readonly timeouts: AITimeoutConfig;
  private readonly logger: AIInteractionLogger;
  private readonly clock: AIClock;
  private readonly timer: AITimer;

  constructor(options: ResilientAIServiceOptions) {
    this.providers = options.providers ?? [];
    this.timeouts = options.timeouts ?? DEFAULT_AI_TIMEOUTS;
    this.logger = options.logger;
    this.clock = options.clock ?? (() => Date.now());
    this.timer = options.timer ?? systemAITimer;
  }

  /**
   * Whether at least one provider is configured. When `false` callers SHOULD
   * skip the AI enhancement and continue the core operation (Requirement 20.5).
   */
  isEnabled(): boolean {
    return this.providers.length > 0;
  }

  /** Resolves the timeout budget (ms) for an operation kind (Requirement 20.4). */
  timeoutFor(kind: AIOperationKind): number {
    return timeoutForOperation(kind, this.timeouts);
  }

  /**
   * Runs a generic completion under the {@link AIOperationKind.Query} budget
   * (the interactive default). Capability wrappers call
   * {@link completeForOperation} to apply the report/prediction budgets.
   */
  complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    return this.completeForOperation(request, AIOperationKind.Query);
  }

  async completeForOperation(
    request: AICompletionRequest,
    operationKind: AIOperationKind,
  ): Promise<AICompletionResponse> {
    const startedAt = this.clock();

    // Graceful degradation: nothing configured → never crash, signal unavailable
    // so the caller continues the core operation (Requirement 20.5).
    if (this.providers.length === 0) {
      this.logInteraction({
        outcome: 'unavailable',
        operationKind,
        context: request.context,
        latencyMs: this.clock() - startedAt,
      });
      throw new AIUnavailableError('No AI provider is configured', { operationKind });
    }

    const timeoutMs = request.timeoutMs ?? this.timeoutFor(operationKind);
    const ordered = this.selectProviders(request.provider);

    let sawTimeout = false;
    let lastError: unknown;

    // Failover: try each provider in order; a failure (including a timeout)
    // moves on to the next (Requirement 20.2).
    for (const provider of ordered) {
      try {
        const response = await this.runWithTimeout(provider, request, timeoutMs);
        this.logInteraction({
          outcome: 'success',
          operationKind,
          context: request.context,
          latencyMs: this.clock() - startedAt,
          provider: response.provider,
          model: response.model,
          usage: response.usage,
        });
        return response;
      } catch (error) {
        lastError = error;
        if (error instanceof TimeoutSignal) {
          sawTimeout = true;
          this.logInteraction({
            outcome: 'timeout',
            operationKind,
            context: request.context,
            latencyMs: this.clock() - startedAt,
            provider: error.provider,
          });
        } else {
          this.logInteraction({
            outcome: 'error',
            operationKind,
            context: request.context,
            latencyMs: this.clock() - startedAt,
            provider: provider.kind,
          });
        }
        // continue to the next provider (failover)
      }
    }

    // Every provider failed. Surface the most specific error: a timeout when the
    // last attempt exceeded its budget (Requirement 20.4), otherwise unavailable
    // so the caller degrades gracefully (Requirement 20.5).
    if (sawTimeout && lastError instanceof TimeoutSignal) {
      throw new AITimeoutError(`AI ${operationKind} timed out after ${timeoutMs}ms`, {
        operationKind,
        provider: lastError.provider,
      });
    }
    throw new AIUnavailableError('All AI providers failed', { operationKind });
  }

  /**
   * Orders providers for a request: an explicitly requested provider first (so
   * an override is honoured, Requirement 20.2), then the remaining providers in
   * configured order as failover targets. An unknown requested provider simply
   * falls back to the configured order.
   */
  private selectProviders(requested?: AIProviderKind): readonly AIProvider[] {
    if (requested === undefined) {
      return this.providers;
    }
    const preferred = this.providers.filter((p) => p.kind === requested);
    if (preferred.length === 0) {
      return this.providers;
    }
    const rest = this.providers.filter((p) => p.kind !== requested);
    return [...preferred, ...rest];
  }

  /**
   * Races a single provider call against the timeout budget. Resolves with the
   * provider response, or rejects with a {@link TimeoutSignal} on timeout / the
   * provider's own error on failure. The timer is always cancelled so it never
   * keeps the event loop alive.
   */
  private async runWithTimeout(
    provider: AIProvider,
    request: AICompletionRequest,
    timeoutMs: number,
  ): Promise<AICompletionResponse> {
    let cancel: (() => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      cancel = this.timer.schedule(() => {
        reject(new TimeoutSignal(provider.kind));
      }, timeoutMs);
    });
    try {
      return await Promise.race([provider.complete(request), timeout]);
    } finally {
      cancel?.();
    }
  }

  /**
   * Emits ONE structured cost-tracking log line for an interaction
   * (Requirement 20.6). NEVER throws: cost logging must not break the AI call or
   * the core operation it enhances.
   */
  private logInteraction(entry: {
    outcome: AIInteractionOutcome;
    operationKind: AIOperationKind;
    context: AIRequestContext;
    latencyMs: number;
    provider?: AIProviderKind;
    model?: string;
    usage?: AICompletionResponse['usage'];
  }): void {
    try {
      const line: Record<string, unknown> = {
        event: AI_INTERACTION_LOG_EVENT,
        outcome: entry.outcome,
        operation_kind: entry.operationKind,
        latency_ms: entry.latencyMs,
        tenant_id: entry.context.tenantId,
      };
      if (entry.context.userId !== undefined) {
        line.user_id = entry.context.userId;
      }
      if (entry.context.requestId !== undefined) {
        line.request_id = entry.context.requestId;
      }
      if (entry.provider !== undefined) {
        line.provider = entry.provider;
      }
      if (entry.model !== undefined) {
        line.model = entry.model;
      }
      if (entry.usage !== undefined) {
        line.prompt_tokens = entry.usage.promptTokens;
        line.completion_tokens = entry.usage.completionTokens;
        line.total_tokens = entry.usage.totalTokens;
        if (entry.usage.estimatedCost !== undefined) {
          line.estimated_cost = entry.usage.estimatedCost;
        }
      }
      this.logger.info(line, 'ai interaction');
    } catch {
      // Swallow: cost-tracking logging must never break the AI call or the core
      // operation it enhances (Requirement 20.5/20.6).
    }
  }
}
