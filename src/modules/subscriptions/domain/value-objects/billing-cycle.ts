import { ValidationError } from '@domain/errors/index.js';

/**
 * Billing cadence of a subscription {@link import('../entities/plan.js').Plan}.
 *
 * - `monthly` — billed once per calendar month; a subscription's default term is
 *   one month from its start date.
 * - `yearly`  — billed once per calendar year; a subscription's default term is
 *   one year from its start date.
 *
 * Mirrors the free-form `Plan.billingCycle` column, which the domain constrains
 * to exactly these two values.
 */
export type BillingCycle = 'monthly' | 'yearly';

/** All valid billing cycles. */
export const BILLING_CYCLES: readonly BillingCycle[] = ['monthly', 'yearly'] as const;

/** Type guard: `true` when `value` is a recognised {@link BillingCycle}. */
export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === 'string' && (BILLING_CYCLES as readonly string[]).includes(value);
}

/**
 * Narrows an arbitrary value to a {@link BillingCycle}.
 *
 * @throws {ValidationError} when `value` is not a recognised billing cycle.
 */
export function assertBillingCycle(value: unknown): BillingCycle {
  if (!isBillingCycle(value)) {
    throw new ValidationError('Invalid billing cycle', { value, allowed: BILLING_CYCLES });
  }
  return value;
}
