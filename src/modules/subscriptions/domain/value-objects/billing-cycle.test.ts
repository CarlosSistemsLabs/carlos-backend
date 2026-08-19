import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import { assertBillingCycle, isBillingCycle, BILLING_CYCLES } from './billing-cycle.js';

describe('billing-cycle', () => {
  it('recognises the two valid cycles', () => {
    expect(BILLING_CYCLES).toEqual(['monthly', 'yearly']);
    expect(isBillingCycle('monthly')).toBe(true);
    expect(isBillingCycle('yearly')).toBe(true);
  });

  it('rejects unknown values via the type guard', () => {
    expect(isBillingCycle('weekly')).toBe(false);
    expect(isBillingCycle(42)).toBe(false);
    expect(isBillingCycle(null)).toBe(false);
  });

  it('assertBillingCycle returns the value or throws', () => {
    expect(assertBillingCycle('yearly')).toBe('yearly');
    expect(() => assertBillingCycle('daily')).toThrow(ValidationError);
  });
});
