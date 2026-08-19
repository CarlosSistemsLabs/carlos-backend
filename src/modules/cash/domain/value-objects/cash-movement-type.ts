import { ValidationError } from '@domain/errors/index.js';

/**
 * The direction of a cash-register movement (Requirement 9.1). Mirrors the
 * free-text `CashMovement.type` column, whose only two persisted values are
 * `"INCOME"` and `"EXPENSE"`.
 *
 * The register's *lifecycle* (opening / closing) is **not** modelled as extra
 * movement types — the schema only allows INCOME/EXPENSE — but through the
 * orthogonal {@link import('./cash-movement-category.js').CashMovementCategory}
 * (`opening` / `closing`). An opening float is therefore an `INCOME` with
 * category `opening`; a closing overage is an `INCOME`/shortage an `EXPENSE`
 * with category `closing`. See the Cash module facade for the full rationale.
 */
export const CASH_MOVEMENT_TYPES = ['INCOME', 'EXPENSE'] as const;

/** A validated cash-movement type. */
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

/**
 * The effect a movement type has on the register balance.
 *
 * - `+1` — `INCOME` increases the on-hand balance.
 * - `-1` — `EXPENSE` decreases the on-hand balance.
 */
export type CashMovementDelta = 1 | -1;

/** Sign conventions for the two movement types. */
const MOVEMENT_DELTAS: Record<CashMovementType, CashMovementDelta> = {
  INCOME: 1,
  EXPENSE: -1,
};

/** Returns `true` when `value` is one of the valid movement types. */
export function isCashMovementType(value: unknown): value is CashMovementType {
  return typeof value === 'string' && (CASH_MOVEMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validates and returns a {@link CashMovementType}.
 *
 * @throws {ValidationError} when `value` is not `INCOME` or `EXPENSE`.
 */
export function assertCashMovementType(value: unknown): CashMovementType {
  if (!isCashMovementType(value)) {
    throw new ValidationError(
      `Cash movement type must be one of: ${CASH_MOVEMENT_TYPES.join(', ')}`,
      { type: value },
    );
  }
  return value;
}

/** Returns the balance delta (`+1` / `-1`) for a movement type. */
export function cashMovementDelta(type: CashMovementType): CashMovementDelta {
  return MOVEMENT_DELTAS[type];
}
