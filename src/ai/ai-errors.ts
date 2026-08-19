import { DomainError, ErrorCode } from '@domain/errors/index.js';
import type { AIOperationKind, AIProviderKind } from './ai-service.js';

/**
 * AI Integration Layer — domain error contracts (task 37.1, Requirements 20.4,
 * 20.5).
 *
 * These errors extend the domain {@link DomainError} hierarchy so outer layers
 * translate them into transport responses exactly like every other domain error
 * (via their {@link DomainError.code} + {@link DomainError.httpStatus}), while
 * the domain stays free of any vendor SDK (Requirement 20.3). The resilient
 * wrapper (task 37.2) throws these so callers can implement GRACEFUL DEGRADATION
 * (Requirement 20.5): treat an {@link AIUnavailableError} as "skip the AI
 * enhancement and continue the core operation" rather than a hard failure, and
 * distinguish a timeout ({@link AITimeoutError}, Requirement 20.4) from a
 * provider outage. Contract-only here — no throwing sites are wired yet.
 */

/**
 * Optional structured context attached to an {@link AIError}, surfaced through
 * {@link DomainError.details} for logging/cost-tracking correlation
 * (Requirement 20.6) without leaking provider internals.
 */
export interface AIErrorContext {
  /** The provider involved, when known (Requirement 20.2). */
  readonly provider?: AIProviderKind;
  /** The operation category being performed, when known (Requirement 20.4). */
  readonly operationKind?: AIOperationKind;
}

/**
 * Abstract base for every AI-layer error. Concrete subclasses supply the stable
 * {@link ErrorCode} and suggested HTTP status; all carry optional
 * {@link AIErrorContext} (provider + operation kind) in `details`.
 */
export abstract class AIError extends DomainError {
  protected constructor(message: string, context?: AIErrorContext) {
    // Only attach details when at least one context field is present, so
    // `details` stays undefined otherwise (exactOptionalPropertyTypes-friendly).
    super(message, buildDetails(context));
  }
}

/** Builds a plain details record from the optional context, or `undefined`. */
function buildDetails(context?: AIErrorContext): Record<string, unknown> | undefined {
  if (context === undefined) {
    return undefined;
  }
  const details: Record<string, unknown> = {};
  if (context.provider !== undefined) {
    details.provider = context.provider;
  }
  if (context.operationKind !== undefined) {
    details.operationKind = context.operationKind;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

/**
 * Raised when no AI provider is available (none configured, all providers
 * unreachable, or the feature disabled). Signals GRACEFUL DEGRADATION
 * (Requirement 20.5): the caller should continue the core operation without the
 * AI enhancement. Maps to HTTP 503 Service Unavailable.
 */
export class AIUnavailableError extends AIError {
  public readonly code = ErrorCode.AI_UNAVAILABLE;
  public readonly httpStatus = 503;

  constructor(message = 'AI service is currently unavailable', context?: AIErrorContext) {
    super(message, context);
  }
}

/**
 * Raised when an AI operation exceeds its per-operation timeout budget
 * (Requirement 20.4: 10s queries, 30s reports, 60s predictions). Distinct from
 * {@link AIUnavailableError} so callers can tell a slow provider from an absent
 * one. Maps to HTTP 504 Gateway Timeout.
 */
export class AITimeoutError extends AIError {
  public readonly code = ErrorCode.AI_TIMEOUT;
  public readonly httpStatus = 504;

  constructor(message = 'AI operation timed out', context?: AIErrorContext) {
    super(message, context);
  }
}
