import { ValidationError } from '@domain/errors/index.js';

/**
 * The business classification of a cash-register movement (Requirement 9.1).
 *
 * The `CashMovement.category` column is a free-text string; the schema comment
 * lists `sale`, `purchase` and `other`, but this module treats the column as a
 * **superset** that also carries the register-lifecycle markers `opening` and
 * `closing`. Combining the two orthogonal axes — direction
 * ({@link import('./cash-movement-type.js').CashMovementType}) and category —
 * lets the register lifecycle be modelled without a dedicated status column:
 *
 * - `opening`  — the opening float booked when a register is opened (INCOME).
 * - `closing`  — the reconciliation adjustment booked at close (INCOME overage
 *                / EXPENSE shortage).
 * - `sale`     — cash received against a sale.
 * - `purchase` — cash paid out against a purchase.
 * - `other`    — any manual/ad-hoc movement.
 */
export const CASH_MOVEMENT_CATEGORIES = [
  'sale',
  'purchase',
  'opening',
  'closing',
  'other',
] as const;

/** A validated cash-movement category. */
export type CashMovementCategory = (typeof CASH_MOVEMENT_CATEGORIES)[number];

/** Returns `true` when `value` is one of the valid movement categories. */
export function isCashMovementCategory(value: unknown): value is CashMovementCategory {
  return (
    typeof value === 'string' && (CASH_MOVEMENT_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Validates and returns a {@link CashMovementCategory}.
 *
 * @throws {ValidationError} when `value` is not a recognised category.
 */
export function assertCashMovementCategory(value: unknown): CashMovementCategory {
  if (!isCashMovementCategory(value)) {
    throw new ValidationError(
      `Cash movement category must be one of: ${CASH_MOVEMENT_CATEGORIES.join(', ')}`,
      { category: value },
    );
  }
  return value;
}
