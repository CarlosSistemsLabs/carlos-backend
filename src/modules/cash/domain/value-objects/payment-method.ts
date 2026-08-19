import { ValidationError } from '@domain/errors/index.js';

/**
 * The tender used to settle a payment (Requirement 9.1). Mirrors the free-text
 * `Payment.method` column (`"cash" | "card" | "transfer" | "check"`).
 */
export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'check'] as const;

/** A validated payment method. */
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Returns `true` when `value` is one of the valid payment methods. */
export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Validates and returns a {@link PaymentMethod}.
 *
 * @throws {ValidationError} when `value` is not a recognised method.
 */
export function assertPaymentMethod(value: unknown): PaymentMethod {
  if (!isPaymentMethod(value)) {
    throw new ValidationError(`Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`, {
      method: value,
    });
  }
  return value;
}
