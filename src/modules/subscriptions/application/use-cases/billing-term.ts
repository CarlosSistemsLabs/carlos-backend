import type { BillingCycle } from '../../domain/value-objects/billing-cycle.js';

/**
 * Adds `months` calendar months to `date`, clamping the day of month so a
 * shorter target month never rolls the result into the following month (e.g.
 * Jan 31 + 1 month → Feb 28/29, not Mar 3). Computed in UTC for determinism.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  // Move to the 1st before shifting the month so the shift never overflows,
  // then clamp the day to the target month's length.
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, daysInTargetMonth));
  return result;
}

/**
 * Computes the default term-end date for a subscription starting at `startDate`
 * on the given billing cycle: one month later for `monthly`, one year later for
 * `yearly`.
 */
export function computeTermEnd(startDate: Date, billingCycle: BillingCycle): Date {
  return billingCycle === 'yearly' ? addMonths(startDate, 12) : addMonths(startDate, 1);
}
