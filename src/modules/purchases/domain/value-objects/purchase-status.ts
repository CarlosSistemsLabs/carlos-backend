import { ValidationError } from '@domain/errors/index.js';
import { InvalidPurchaseStatusTransitionError } from '../errors/purchase-errors.js';

/**
 * Lifecycle status of a {@link import('../entities/purchase.js').Purchase}.
 *
 * - `draft`     — an editable, not-yet-finalised purchase. Does not affect stock.
 * - `completed` — a finalised purchase. Publishing `PurchaseCompleted` (task
 *                 21.2) drives the stock **increment**.
 * - `cancelled` — a voided purchase. Terminal.
 *
 * Mirrors the `Purchase.status` column default of `"completed"`.
 *
 * **Module-boundary note:** this mirrors the Sales module's `SaleStatus` state
 * machine exactly. A shared `DocumentStatus` value object could be promoted to
 * the shared kernel, but the established convention (see `Money`'s promotion
 * note) is to keep module-local copies unless the sharing is unambiguous and
 * broad. Sale and purchase lifecycles may diverge (e.g. purchases could later
 * gain a `received`/`partial` state), so a local copy preserves each module's
 * autonomy without a premature abstraction.
 */
export type PurchaseStatus = 'draft' | 'completed' | 'cancelled';

/** All valid purchase statuses, in lifecycle order. */
export const PURCHASE_STATUSES: readonly PurchaseStatus[] = [
  'draft',
  'completed',
  'cancelled',
] as const;

/** The status a freshly persisted purchase receives when none is supplied. */
export const DEFAULT_PURCHASE_STATUS: PurchaseStatus = 'completed';

/**
 * Allowed forward transitions of the purchase state machine:
 * - `draft`     → `completed` | `cancelled`
 * - `completed` → `cancelled`
 * - `cancelled` → (terminal)
 */
const ALLOWED_TRANSITIONS: Readonly<Record<PurchaseStatus, readonly PurchaseStatus[]>> = {
  draft: ['completed', 'cancelled'],
  completed: ['cancelled'],
  cancelled: [],
};

/** Type guard: `true` when `value` is a recognised {@link PurchaseStatus}. */
export function isPurchaseStatus(value: unknown): value is PurchaseStatus {
  return typeof value === 'string' && (PURCHASE_STATUSES as readonly string[]).includes(value);
}

/**
 * Narrows an arbitrary value to a {@link PurchaseStatus}.
 *
 * @throws {ValidationError} when `value` is not a recognised status.
 */
export function assertPurchaseStatus(value: unknown): PurchaseStatus {
  if (!isPurchaseStatus(value)) {
    throw new ValidationError('Invalid purchase status', { value, allowed: PURCHASE_STATUSES });
  }
  return value;
}

/** Returns `true` when `from → to` is an allowed transition (excluding no-op). */
export function canTransition(from: PurchaseStatus, to: PurchaseStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Asserts that `from → to` is a legal transition.
 *
 * @throws {InvalidPurchaseStatusTransitionError} when the transition is not allowed.
 */
export function assertTransition(from: PurchaseStatus, to: PurchaseStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidPurchaseStatusTransitionError(from, to);
  }
}
