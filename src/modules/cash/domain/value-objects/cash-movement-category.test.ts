import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import {
  CASH_MOVEMENT_CATEGORIES,
  assertCashMovementCategory,
  isCashMovementCategory,
} from './cash-movement-category.js';

describe('CashMovementCategory', () => {
  it('is a superset that includes the lifecycle markers opening/closing', () => {
    expect(CASH_MOVEMENT_CATEGORIES).toEqual(['sale', 'purchase', 'opening', 'closing', 'other']);
    for (const category of CASH_MOVEMENT_CATEGORIES) {
      expect(isCashMovementCategory(category)).toBe(true);
    }
    expect(isCashMovementCategory('refund')).toBe(false);
    expect(isCashMovementCategory(null)).toBe(false);
  });

  it('asserts valid categories and throws on invalid', () => {
    expect(assertCashMovementCategory('opening')).toBe('opening');
    expect(assertCashMovementCategory('closing')).toBe('closing');
    expect(() => assertCashMovementCategory('deposit')).toThrow(ValidationError);
  });
});
