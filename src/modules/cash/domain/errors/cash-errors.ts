import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';

/**
 * Raised when a monetary amount that must be strictly positive (a movement or
 * payment amount) is zero or negative. Cash movements and payments always carry
 * a positive amount; the *direction* is expressed by the movement type, never
 * by the sign of the amount (Requirement 9.1).
 */
export class NonPositiveAmountError extends ValidationError {
  constructor(context: Record<string, unknown> = {}) {
    super('Amount must be a positive value', context);
  }
}

/**
 * Raised when an `EXPENSE` would drive the register balance below zero.
 *
 * **Overdraft policy:** a cash register models physical cash on hand, which can
 * never be negative — you cannot pay out more than the drawer holds. Expenses
 * are therefore guarded and rejected when they exceed the current balance
 * rather than being allowed to overdraw. This is a {@link BusinessRuleError}
 * (a genuine invariant breach), not an input typo.
 */
export class InsufficientCashBalanceError extends BusinessRuleError {
  constructor(balance: string, requested: string, currency: string) {
    super('Cash register balance cannot go negative', { balance, requested, currency });
  }
}

/**
 * Raised when a movement is applied to a register it does not belong to (its
 * `cashId` does not match the aggregate's id). The aggregate owns its balance,
 * so it refuses to apply another register's movement.
 */
export class CashMovementMismatchError extends BusinessRuleError {
  constructor(cashId: string, movementCashId: string) {
    super('Cash movement does not belong to this register', { cashId, movementCashId });
  }
}

/**
 * Raised when a {@link import('../entities/payment.js').Payment} is created that
 * does not reference **exactly one** of a sale or a purchase.
 *
 * **Payment link rule:** every payment settles either a sale (money in) or a
 * purchase (money out) — never both and never neither. A payment linked to both
 * would be ambiguous; one linked to neither has no document to settle. This
 * invariant keeps the `Payment.saleId` / `Payment.purchaseId` nullable columns
 * mutually exclusive and jointly required.
 */
export class InvalidPaymentLinkError extends ValidationError {
  constructor(context: Record<string, unknown> = {}) {
    super('A payment must reference exactly one of a sale or a purchase', context);
  }
}

/**
 * Raised when a payment's amount exceeds the outstanding balance of the sale or
 * purchase it settles.
 *
 * **Overpayment policy:** a payment can settle at most the *outstanding* balance
 * of its document (`total - alreadyPaid`). Tendering more than what is owed is
 * rejected rather than silently recorded, so the sum of a document's payments
 * can never exceed its billed total and its derived
 * {@link import('../value-objects/payment-status.js').PaymentStatus} tops out at
 * `paid`. This is a {@link BusinessRuleError} (a genuine invariant breach), not
 * an input typo. Change/refund handling (recording the excess as change) is out
 * of scope here; overpayment is refused.
 */
export class PaymentOverpaymentError extends BusinessRuleError {
  constructor(requested: string, outstanding: string, currency: string) {
    super('Payment amount exceeds the outstanding balance', {
      requested,
      outstanding,
      currency,
    });
  }
}
