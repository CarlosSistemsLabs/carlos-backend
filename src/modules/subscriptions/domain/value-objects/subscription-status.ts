import { ValidationError } from '@domain/errors/index.js';
import { InvalidSubscriptionStatusTransitionError } from '../errors/subscription-errors.js';

/**
 * Lifecycle status of a {@link import('../entities/subscription.js').Subscription}.
 *
 * - `active`    — a live subscription granting its plan's features (subject to
 *                 the `endDate` still being in the future, checked temporally by
 *                 {@link import('../entities/subscription.js').Subscription.isActive}).
 * - `cancelled` — the tenant (or an operator) ended the subscription. Terminal.
 * - `expired`   — the subscription's term lapsed (its `endDate` passed and it was
 *                 not renewed). May be revived by a renewal.
 *
 * Mirrors the `Subscription.status` column default of `"active"`.
 */
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired';

/** All valid subscription statuses. */
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'active',
  'cancelled',
  'expired',
] as const;

/** The status a freshly created subscription receives when none is supplied. */
export const DEFAULT_SUBSCRIPTION_STATUS: SubscriptionStatus = 'active';

/**
 * Allowed transitions of the subscription state machine:
 * - `active`    → `cancelled` | `expired`
 * - `expired`   → `active` (via renewal) | `cancelled`
 * - `cancelled` → (terminal)
 *
 * A cancelled subscription is terminal: a tenant that wants service again gets a
 * brand-new subscription rather than reviving a cancelled one. An expired
 * subscription can be revived by a renewal (Requirement 10.6).
 */
const ALLOWED_TRANSITIONS: Readonly<Record<SubscriptionStatus, readonly SubscriptionStatus[]>> = {
  active: ['cancelled', 'expired'],
  expired: ['active', 'cancelled'],
  cancelled: [],
};

/** Type guard: `true` when `value` is a recognised {@link SubscriptionStatus}. */
export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Narrows an arbitrary value to a {@link SubscriptionStatus}.
 *
 * @throws {ValidationError} when `value` is not a recognised status.
 */
export function assertSubscriptionStatus(value: unknown): SubscriptionStatus {
  if (!isSubscriptionStatus(value)) {
    throw new ValidationError('Invalid subscription status', {
      value,
      allowed: SUBSCRIPTION_STATUSES,
    });
  }
  return value;
}

/** Returns `true` when `from → to` is an allowed transition (excluding no-op). */
export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Asserts that `from → to` is a legal transition.
 *
 * @throws {InvalidSubscriptionStatusTransitionError} when the transition is not allowed.
 */
export function assertTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidSubscriptionStatusTransitionError(from, to);
  }
}
