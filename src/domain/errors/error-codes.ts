/**
 * Stable, machine-readable error codes for the domain layer.
 *
 * Codes are intended to be safe to expose to API clients and to map onto
 * transport-level concerns (e.g. HTTP status) in outer layers.
 */
export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  BUSINESS_RULE: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
  /**
   * A downstream service is being protected by an OPEN circuit breaker and is
   * temporarily unavailable (Requirement 27.3). The resilience layer trips a
   * breaker after a configured number of consecutive failures and rejects
   * further calls fast until a cooldown elapses, giving the dependency room to
   * recover instead of hammering it. Maps to HTTP 503 Service Unavailable.
   */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /**
   * A downstream AI provider (OpenAI/Claude/Gemini) is unreachable or disabled
   * (Requirement 20.5). Callers translate this into graceful degradation rather
   * than surfacing it as a hard failure of a core operation.
   */
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  /**
   * An AI operation exceeded its per-operation timeout budget
   * (Requirement 20.4: 10s queries, 30s reports, 60s predictions).
   */
  AI_TIMEOUT: 'AI_TIMEOUT',
} as const;

/** Union of all valid {@link ErrorCode} values. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
