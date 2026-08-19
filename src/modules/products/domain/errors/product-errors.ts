import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';

/**
 * Raised when a product price violates the "price must be greater than zero"
 * invariant (Requirement 9.1). A non-positive price is a domain rule breach
 * rather than a mere input typing error, hence a {@link BusinessRuleError}.
 */
export class InvalidPriceError extends BusinessRuleError {
  constructor(amount: string) {
    super(`Product price must be greater than zero (received "${amount}")`, { amount });
  }
}

/**
 * Raised when a product cost is negative. Cost may be zero (e.g. promotional or
 * sample items) but never negative.
 */
export class InvalidCostError extends BusinessRuleError {
  constructor(amount: string) {
    super(`Product cost cannot be negative (received "${amount}")`, { amount });
  }
}

/**
 * Re-exported from the shared kernel where it now lives alongside the promoted
 * {@link Money} value object. Kept exported here to preserve the Products
 * module's historical public API: raised when an arithmetic operation is
 * attempted on two {@link Money} values of different currencies.
 */
export { CurrencyMismatchError } from '@shared/value-objects/money.js';

/**
 * Raised when a category is set as its own parent. Full multi-level cycle
 * detection across the category tree is a use-case concern (task 13.4); the
 * entity only guards the immediate self-reference it can see.
 */
export class SelfParentCategoryError extends ValidationError {
  constructor(categoryId: string) {
    super('A category cannot be its own parent', { categoryId });
  }
}
