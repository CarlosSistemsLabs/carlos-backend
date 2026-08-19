import { BusinessRuleError } from '@domain/errors/index.js';

/**
 * Raised when a decrease (or `OUT`/`TRANSFER` movement) would drive a stock
 * balance below zero (Requirement 9.1). Negative on-hand quantity is a domain
 * invariant breach rather than a mere input error, hence a
 * {@link BusinessRuleError} (HTTP 422).
 */
export class InsufficientStockError extends BusinessRuleError {
  constructor(available: number, requested: number) {
    super(
      `Insufficient stock: requested ${requested} but only ${available} available`,
      { available, requested },
    );
  }
}

/**
 * Raised when a `TRANSFER` is requested between a branch and itself, or without
 * a distinct destination branch. A transfer must move units between two
 * different locations to have any effect.
 */
export class InvalidStockTransferError extends BusinessRuleError {
  constructor(message = 'A stock transfer requires a distinct destination branch') {
    super(message);
  }
}
