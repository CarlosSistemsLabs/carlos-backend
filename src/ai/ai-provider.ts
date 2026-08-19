import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProviderKind,
} from './ai-service.js';
import { AIUnavailableError } from './ai-errors.js';

/**
 * AI Integration Layer — provider PORT (task 37.2, Requirements 20.2, 20.5).
 *
 * ## What this is
 * {@link AIProvider} is the small, vendor-shaped seam the resilient wrapper
 * ({@link import('./resilient-ai-service.js').ResilientAIService}) composes to
 * actually run a completion. It sits BELOW the application-facing
 * {@link import('./ai-service.js').IAIService} port and ABOVE the concrete LLM
 * adapters. One adapter per vendor (OpenAI / Claude / Gemini) implements this
 * interface, each pinned to its {@link AIProviderKind} so the wrapper can route
 * a request to a requested provider and FAILOVER to the next on failure
 * (Requirement 20.2).
 *
 * ## Why a dedicated port (not the plugin `AIPlugin`)
 * The plugin `AIPlugin` (`src/plugins/plugin.ts`) models a low-level
 * prompt/analysis surface with its OWN request/response types and lifecycle. A
 * concrete adapter built on an `AIPlugin` (task 37.3 / later) will implement
 * THIS port by translating the richer {@link AICompletionRequest}
 * (tenant context, provider hint, timeout) to the plugin call and mapping the
 * plugin result back to an {@link AICompletionResponse} with
 * {@link import('./ai-service.js').AITokenUsage}. Keeping a separate port means
 * the resilient wrapper depends on a stable, usage-reporting contract rather
 * than on the plugin shape, and the timeout/failover/logging concerns live in
 * ONE place.
 *
 * ## No real API calls here
 * No vendor SDK is imported and no network call is made anywhere in this layer
 * (Requirement 20.3). Concrete adapters bind LATER; until then the composition
 * root wires the wrapper with NO providers, which yields graceful degradation
 * (Requirement 20.5): {@link import('./ai-service.js').IAIService.isEnabled}
 * returns `false` and completions throw {@link AIUnavailableError}.
 *
 * ## Resilience seam (tasks 41.2 / 41.3)
 * A circuit breaker and retry-with-backoff (tasks 41.x, NOT yet implemented)
 * will WRAP each {@link AIProvider.complete} call without changing this
 * contract: the wrapper can decorate each provider with those policies, or a
 * `CircuitBreakerAIProvider` can implement {@link AIProvider} over a delegate.
 * Either way the timeout + failover + cost logging built here stay intact.
 */
export interface AIProvider {
  /**
   * Which vendor this provider serves (Requirement 20.2). Lets the resilient
   * wrapper honour an explicit {@link AICompletionRequest.provider} selection and
   * attribute usage/cost per provider.
   */
  readonly kind: AIProviderKind;

  /**
   * Runs a single completion against the underlying vendor. MUST resolve with an
   * {@link AICompletionResponse} (including {@link AICompletionResponse.usage}
   * when the vendor reports it) or reject on failure. Implementations MUST NOT
   * enforce their own timeout — the resilient wrapper owns the per-operation
   * timeout budget (Requirement 20.4) so it stays consistent and testable.
   *
   * @param request - The prompt, tenant context and generation options.
   */
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
}

/**
 * A placeholder {@link AIProvider} that is never able to serve a request: every
 * {@link complete} call rejects with {@link AIUnavailableError}.
 *
 * ## When to use
 * This is an EXPLICIT "configured but disabled" provider — useful in tests that
 * exercise the all-providers-fail path, or as a named stand-in before a real
 * adapter binds. The DEFAULT dev/production graceful-degradation path does NOT
 * use this: it configures the resilient wrapper with an EMPTY provider list, so
 * {@link import('./ai-service.js').IAIService.isEnabled} reports `false` and
 * callers skip AI entirely (Requirement 20.5). Including a
 * {@link NoopAIProvider} instead would report `isEnabled() === true` yet fail
 * every call, which is only desirable when you specifically want to model a
 * present-but-broken provider.
 */
export class NoopAIProvider implements AIProvider {
  /**
   * @param kind - The vendor this placeholder stands in for (default `'openai'`).
   */
  constructor(readonly kind: AIProviderKind = 'openai') {}

  complete(_request: AICompletionRequest): Promise<AICompletionResponse> {
    return Promise.reject(
      new AIUnavailableError('AI provider is not configured', { provider: this.kind }),
    );
  }
}
