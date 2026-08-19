import { ValidationError } from '@domain/errors/index.js';

/**
 * The kinds of stock movement recorded in the inventory audit trail
 * (Requirement 9.1). Mirrors the free-text `StockMovement.type` column
 * (`"IN" | "OUT" | "ADJUSTMENT" | "TRANSFER"`).
 */
export const STOCK_MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'] as const;

/** A validated stock-movement type. */
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * The effect a movement type has on a single stock balance.
 *
 * - `+1` — the movement increases on-hand quantity.
 * - `-1` — the movement decreases on-hand quantity.
 * - `0`  — the movement is not a single-balance operation (see `TRANSFER`).
 */
export type StockMovementDelta = 1 | -1 | 0;

/**
 * Sign conventions for the four movement types (Requirement 9.1). Every
 * recorded {@link StockMovement} carries a **positive** quantity; the *type*
 * determines the direction the balance moves:
 *
 * - **IN** `(+)` — goods received (e.g. a purchase). Increases on-hand quantity.
 * - **ADJUSTMENT** `(+)` — a positive manual correction (e.g. an inventory
 *   count found extra units). Increases on-hand quantity. Downward corrections
 *   are recorded as an `OUT` movement so the "quantity > 0" audit invariant
 *   holds for every row; a signed-delta adjustment is intentionally out of
 *   scope for this iteration.
 * - **OUT** `(-)` — goods leaving stock (e.g. a sale). Decreases on-hand
 *   quantity and is guarded so a balance can never go negative.
 * - **TRANSFER** `(0)` — moves units *between branches*. It is not a
 *   single-balance operation: it is applied as two legs (a decrease on the
 *   source branch and an increase on the destination branch), so it maps to a
 *   delta of `0` at the individual-balance level and is handled by the
 *   application layer (see `AdjustStockUseCase`).
 */
const MOVEMENT_DELTAS: Record<StockMovementType, StockMovementDelta> = {
  IN: 1,
  ADJUSTMENT: 1,
  OUT: -1,
  TRANSFER: 0,
};

/** Returns `true` when `value` is one of the four valid movement types. */
export function isStockMovementType(value: unknown): value is StockMovementType {
  return typeof value === 'string' && (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validates and returns a {@link StockMovementType}.
 *
 * @throws {ValidationError} when `value` is not one of the four supported types.
 */
export function assertStockMovementType(value: unknown): StockMovementType {
  if (!isStockMovementType(value)) {
    throw new ValidationError(
      `Stock movement type must be one of: ${STOCK_MOVEMENT_TYPES.join(', ')}`,
      { type: value },
    );
  }
  return value;
}

/**
 * Returns the balance delta for a movement type per the documented sign
 * conventions ({@link MOVEMENT_DELTAS}).
 */
export function stockMovementDelta(type: StockMovementType): StockMovementDelta {
  return MOVEMENT_DELTAS[type];
}
