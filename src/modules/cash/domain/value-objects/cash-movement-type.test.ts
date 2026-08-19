import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import {
  CASH_MOVEMENT_TYPES,
  assertCashMovementType,
  cashMovementDelta,
  isCashMovementType,
} from './cash-movement-type.js';

describe('CashMovementType', () => {
  it('recognises only INCOME and EXPENSE', () => {
    expect(CASH_MOVEMENT_TYPES).toEqual(['INCOME', 'EXPENSE']);
    expect(isCashMovementType('INCOME')).toBe(true);
    expect(isCashMovementType('EXPENSE')).toBe(true);
    expect(isCashMovementType('income')).toBe(false);
    expect(isCashMovementType('OPENING')).toBe(false);
    expect(isCashMovementType(42)).toBe(false);
  });

  it('asserts valid types and throws on invalid', () => {
    expect(assertCashMovementType('INCOME')).toBe('INCOME');
    expect(() => assertCashMovementType('nope')).toThrow(ValidationError);
  });

  it('maps direction to a signed delta', () => {
    expect(cashMovementDelta('INCOME')).toBe(1);
    expect(cashMovementDelta('EXPENSE')).toBe(-1);
  });
});
