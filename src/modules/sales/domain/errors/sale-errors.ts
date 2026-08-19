import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';
import type { SaleStatus } from '../value-objects/sale-status.js';

/**
 * Raised when a sale is completed/persisted with no line items. A sale must
 * contain at least one product (Requirement 9.1) — an empty sale has no
 * meaningful total and cannot decrement stock.
 */
export class EmptySaleError extends ValidationError {
  constructor() {
    super('A sale must contain at least one line item', {});
  }
}

/**
 * Raised when a line item quantity is not a positive integer. Quantities are
 * counted in whole units and must be strictly greater than zero.
 */
export class InvalidSaleQuantityError extends ValidationError {
  constructor(quantity: number) {
    super('Sale line quantity must be a positive integer', { quantity });
  }
}

/**
 * Raised when a status transition that the state machine forbids is attempted
 * (e.g. `completed → draft` or acting on an already `cancelled` sale). A
 * genuine business-rule breach rather than an input typo, hence a
 * {@link BusinessRuleError}.
 */
export class InvalidSaleStatusTransitionError extends BusinessRuleError {
  constructor(from: SaleStatus, to: SaleStatus) {
    super(`Cannot transition a sale from "${from}" to "${to}"`, { from, to });
  }
}
