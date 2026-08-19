import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';
import type { PurchaseStatus } from '../value-objects/purchase-status.js';

/**
 * Raised when a purchase is completed/persisted with no line items. A purchase
 * must contain at least one product (Requirement 9.1) — an empty purchase has
 * no meaningful total and cannot increment stock.
 */
export class EmptyPurchaseError extends ValidationError {
  constructor() {
    super('A purchase must contain at least one line item', {});
  }
}

/**
 * Raised when a line item quantity is not a positive integer. Quantities are
 * counted in whole units and must be strictly greater than zero.
 */
export class InvalidPurchaseQuantityError extends ValidationError {
  constructor(quantity: number) {
    super('Purchase line quantity must be a positive integer', { quantity });
  }
}

/**
 * Raised when neither the product catalogue nor the request supplies a unit
 * cost for a line (see the cost-source decision on
 * {@link import('../ports/purchase-product-reader.js').IPurchaseProductReader}).
 * A purchase line cannot compute a total without an authoritative cost.
 */
export class MissingProductCostError extends ValidationError {
  constructor(productId: string) {
    super(
      'Product has no catalogue cost and no unit cost was supplied for the purchase line',
      { productId },
    );
  }
}

/**
 * Raised when a status transition that the state machine forbids is attempted
 * (e.g. `completed → draft` or acting on an already `cancelled` purchase). A
 * genuine business-rule breach rather than an input typo, hence a
 * {@link BusinessRuleError}.
 */
export class InvalidPurchaseStatusTransitionError extends BusinessRuleError {
  constructor(from: PurchaseStatus, to: PurchaseStatus) {
    super(`Cannot transition a purchase from "${from}" to "${to}"`, { from, to });
  }
}
