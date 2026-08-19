import { DomainError } from './domain-error.js';
import { ErrorCode } from './error-codes.js';

/**
 * Raised when input fails domain validation or invariants are violated.
 */
export class ValidationError extends DomainError {
  public readonly code = ErrorCode.VALIDATION;
  public readonly httpStatus = 400;

  constructor(message = 'Validation failed', details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Raised when a requested resource cannot be found.
 */
export class NotFoundError extends DomainError {
  public readonly code = ErrorCode.NOT_FOUND;
  public readonly httpStatus = 404;

  constructor(message = 'Resource not found', details?: Record<string, unknown>) {
    super(message, details);
  }

  /**
   * Convenience factory for the common "entity with id not found" case.
   */
  static forEntity(entity: string, id: string): NotFoundError {
    return new NotFoundError(`${entity} with id "${id}" was not found`, {
      entity,
      id,
    });
  }
}

/**
 * Raised when an operation conflicts with the current state (e.g. duplicates).
 */
export class ConflictError extends DomainError {
  public readonly code = ErrorCode.CONFLICT;
  public readonly httpStatus = 409;

  constructor(message = 'Resource conflict', details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Raised when a request lacks valid authentication credentials.
 */
export class UnauthorizedError extends DomainError {
  public readonly code = ErrorCode.UNAUTHORIZED;
  public readonly httpStatus = 401;

  constructor(message = 'Authentication required', details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Raised when an authenticated subject lacks permission for an action.
 */
export class ForbiddenError extends DomainError {
  public readonly code = ErrorCode.FORBIDDEN;
  public readonly httpStatus = 403;

  constructor(message = 'Access denied', details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Raised when a business rule (domain invariant) is violated.
 */
export class BusinessRuleError extends DomainError {
  public readonly code = ErrorCode.BUSINESS_RULE;
  public readonly httpStatus = 422;

  constructor(message = 'Business rule violation', details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Raised when a client exceeds the configured request rate limit.
 */
export class RateLimitError extends DomainError {
  public readonly code = ErrorCode.RATE_LIMITED;
  public readonly httpStatus = 429;

  constructor(message = 'Rate limit exceeded. Please retry later.', details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Generic catch-all for unexpected, unclassified failures (Requirement 21.5).
 *
 * This is the concrete {@link DomainError} counterpart of the sanitized 500 the
 * error handler emits for unknown/unhandled errors: it carries the stable
 * {@link ErrorCode.INTERNAL} code and a `500` HTTP status. Prefer a more
 * specific error where one exists; reach for {@link InternalError} only when a
 * failure genuinely has no better classification. Its user-facing message is
 * localized (or replaced by the generic internal message) by the serializer, so
 * the caller-supplied `message` never leaks to clients.
 */
export class InternalError extends DomainError {
  public readonly code = ErrorCode.INTERNAL;
  public readonly httpStatus = 500;

  constructor(message = 'An unexpected error occurred', details?: Record<string, unknown>) {
    super(message, details);
  }
}
