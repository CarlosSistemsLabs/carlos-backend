import { CircuitBreaker, type CircuitBreakerOptions } from '@common/resilience/index.js';
import type { AICompletionRequest, AICompletionResponse } from './ai-service.js';
import type { AIProvider } from './ai-provider.js';

/**
 * AI Integration Layer — CIRCUIT-BREAKER PROVIDER DECORATOR (task 41.2,
 * Requirements 20.2, 27.3).
 *
 * ## What this is
 * {@link CircuitBreakerAIProvider} is the concrete realisation of the decorator
 * `ai-provider.ts` / `resilient-ai-service.ts` explicitly anticipate: it
 * implements {@link AIProvider} by wrapping a DELEGATE provider and running each
 * `complete` call through a {@link CircuitBreaker}. It adds breaker protection
 * (Requirement 27.3) to a single vendor WITHOUT changing the {@link AIProvider}
 * contract, so a decorated provider drops straight into the existing
 * `ResilientAIService` provider list (timeout + failover + cost-logging keep
 * working around it unchanged).
 *
 * ## Composition (additive; default wiring unchanged)
 * This decorator is OPT-IN. The composition root still wires `ResilientAIService`
 * with an EMPTY provider list by default (graceful degradation, Requirement
 * 20.5); nothing here changes that. When real vendor adapters are bound later,
 * each can be wrapped:
 *
 * ```ts
 * const guarded = new CircuitBreakerAIProvider(openAiProvider, {
 *   name: 'ai:openai',
 *   failureThreshold: 5, // Requirement 27.3
 * });
 * const ai = new ResilientAIService({ providers: [guarded], logger });
 * ```
 *
 * Use ONE breaker per provider so a single failing vendor trips its own breaker
 * and `ResilientAIService` fails over to a healthy one, while the tripped
 * provider is spared until it recovers.
 *
 * ## Behaviour
 * - **CLOSED / HALF_OPEN:** delegates to `delegate.complete(request)` and
 *   returns its response (or propagates its error, counting it toward the
 *   breaker's failure threshold).
 * - **OPEN:** short-circuits with the breaker's `CircuitOpenError` WITHOUT
 *   calling the delegate, so the ailing vendor gets room to recover and
 *   `ResilientAIService` can fail over immediately.
 */
export class CircuitBreakerAIProvider implements AIProvider {
  private readonly breaker: CircuitBreaker;

  /**
   * @param delegate - The underlying provider whose `complete` calls are guarded.
   * @param options - Circuit-breaker tuning. Defaults to a name derived from the
   *   delegate's {@link AIProvider.kind} and the mandated failure threshold of 5
   *   (Requirement 27.3) when not overridden.
   */
  constructor(
    private readonly delegate: AIProvider,
    options: CircuitBreakerOptions = {},
  ) {
    this.breaker = new CircuitBreaker({
      name: options.name ?? `ai:${delegate.kind}`,
      ...options,
    });
  }

  /** The vendor this provider serves — inherited from the wrapped delegate. */
  public get kind(): AIProvider['kind'] {
    return this.delegate.kind;
  }

  /**
   * Runs the delegate completion under the circuit breaker. Throws the breaker's
   * `CircuitOpenError` (without invoking the delegate) while OPEN, otherwise
   * returns the delegate's response or propagates its error.
   *
   * @param request - The prompt, tenant context and generation options.
   */
  public complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    return this.breaker.execute(() => this.delegate.complete(request));
  }

  /**
   * The underlying breaker's live metrics snapshot, for health/observability
   * (e.g. exposing per-provider breaker state on a metrics endpoint).
   */
  public getBreakerMetrics(): ReturnType<CircuitBreaker['getMetrics']> {
    return this.breaker.getMetrics();
  }
}
