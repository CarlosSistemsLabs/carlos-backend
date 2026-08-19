import { ValidationError } from '@domain/errors/index.js';
import { InvalidSaleStatusTransitionError } from '../errors/sale-errors.js';

/**
 * Lifecycle status of a {@link import('../entities/sale.js').Sale}.
 *
 * - `draft`     — an editable, not-yet-finalised sale. Does not affect stock.
 * - `completed` — a finalised sale. Publishing `SaleCompleted` (task 19.2)
 *                 drives the stock decrement.
 * - `cancelled` — a voided sale. Terminal.
 *
 * Mirrors the `Sale.status` column default of `"completed"`.
 */
export type SaleStatus = 'draft' | 'completed' | 'cancelled';

/** All valid sale statuses, in lifecycle order. */
export const SALE_STATUSES: readonly SaleStatus[] = ['draft', 'completed', 'cancelled'] as const;

/** The status a freshly persisted sale receives when none is supplied. */
export const DEFAULT_SALE_STATUS: SaleStatus = 'completed';

/**
 * Allowed forward transitions of the sale state machine:
 * - `draft`     → `completed` | `cancelled`
 * - `completed` → `cancelled`
 * - `cancelled` → (terminal)
 */
const ALLOWED_TRANSITIONS: Readonly<Record<SaleStatus, readonly SaleStatus[]>> = {
  draft: ['completed', 'cancelled'],
  completed: ['cancelled'],
  cancelled: [],
};

/** Type guard: `true` when `value` is a recognised {@link SaleStatus}. */
export function isSaleStatus(value: unknown): value is SaleStatus {
  return typeof value === 'string' && (SALE_STATUSES as readonly string[]).includes(value);
}

/**
 * Narrows an arbitrary value to a {@link SaleStatus}.
 *
 * @throws {ValidationError} when `value` is not a recognised status.
 */
export function assertSaleStatus(value: unknown): SaleStatus {
  if (!isSaleStatus(value)) {
    throw new ValidationError('Invalid sale status', { value, allowed: SALE_STATUSES });
  }
  return value;
}

/** Returns `true` when `from → to` is an allowed transition (excluding no-op). */
export function canTransition(from: SaleStatus, to: SaleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Asserts that `from → to` is a legal transition.
 *
 * @throws {InvalidSaleStatusTransitionError} when the transition is not allowed.
 */
export function assertTransition(from: SaleStatus, to: SaleStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidSaleStatusTransitionError(from, to);
  }
}
