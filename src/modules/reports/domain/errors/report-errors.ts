import { ValidationError } from '@domain/errors/index.js';

/**
 * Raised when a report's requested date range is invalid — specifically when
 * the inclusive lower bound (`from`) is strictly after the upper bound (`to`).
 *
 * Reports are read/aggregation operations bounded by a `[from, to]` window; an
 * inverted range is a caller input error (a {@link ValidationError}), not a
 * business-rule breach. Use cases normalise/validate the range before touching
 * a reader port, so a hostile or buggy client can never issue an aggregation
 * over an impossible window.
 */
export class InvalidDateRangeError extends ValidationError {
  constructor(from: Date, to: Date) {
    super('Report "from" date must be on or before the "to" date', {
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
}
