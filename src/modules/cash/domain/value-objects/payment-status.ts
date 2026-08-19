import type { Money } from '@shared/value-objects/money.js';

/**
 * The settlement state of a sale or purchase, derived from its payments
 * (Requirement 9.1).
 *
 * There is **no persisted status column**: a document's payment status is a
 * pure function of its billed `total` and the sum of the payments recorded
 * against it (see {@link derivePaymentStatus}). This keeps the status always
 * consistent with the payment ledger — it cannot drift out of sync the way a
 * denormalised column could.
 *
 * - `unpaid`  — nothing has been paid yet (paid == 0, total > 0).
 * - `partial` — some but not all of the total has been paid (0 < paid < total).
 * - `paid`    — the total has been fully settled (paid >= total, or total == 0).
 */
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const;

/** A derived payment status. */
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Derives the {@link PaymentStatus} of a document from its billed `total` and
 * the `paid` sum of its payments.
 *
 * The rules, in order:
 * 1. A zero-total document (nothing to charge) is `paid`.
 * 2. Nothing paid → `unpaid`.
 * 3. Paid less than the total → `partial`.
 * 4. Otherwise (paid meets or exceeds the total) → `paid`.
 *
 * @throws {import('@shared/value-objects/money.js').CurrencyMismatchError}
 *   when `total` and `paid` are denominated in different currencies.
 */
export function derivePaymentStatus(total: Money, paid: Money): PaymentStatus {
  if (total.isZero()) {
    return 'paid';
  }
  if (paid.isZero() || paid.isNegative()) {
    return 'unpaid';
  }
  return paid.lessThan(total) ? 'partial' : 'paid';
}
