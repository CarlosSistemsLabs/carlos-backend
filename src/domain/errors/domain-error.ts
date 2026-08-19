import type { ErrorCode } from './error-codes.js';

/**
 * Base class for all domain errors.
 *
 * Domain errors carry a stable {@link ErrorCode} and a suggested HTTP status so
 * outer layers can translate them into transport responses without leaking
 * domain internals. The domain layer itself stays free of framework concerns
 * (Clean Architecture, Requirement 3.2).
 */
export abstract class DomainError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: ErrorCode;

  /** Suggested HTTP status code for the presentation layer. */
  public abstract readonly httpStatus: number;

  /** Optional structured context describing the error. */
  public readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    // `new.target` resolves to the concrete subclass being constructed.
    this.name = new.target.name;
    if (details !== undefined) {
      this.details = details;
    }
    // Restore the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
