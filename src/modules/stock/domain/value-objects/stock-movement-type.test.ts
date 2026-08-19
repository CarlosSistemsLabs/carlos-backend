import { describe, it, expect } from 'vitest';
import {
  STOCK_MOVEMENT_TYPES,
  assertStockMovementType,
  isStockMovementType,
  stockMovementDelta,
} from './stock-movement-type.js';
import { ValidationError } from '@domain/errors/index.js';

describe('StockMovementType', () => {
  it('recognises every valid type', () => {
    for (const type of STOCK_MOVEMENT_TYPES) {
      expect(isStockMovementType(type)).toBe(true);
      expect(assertStockMovementType(type)).toBe(type);
    }
  });

  it.each(['in', 'sale', '', 'TRANSFERS', 42, null, undefined])(
    'rejects invalid value %p',
    (value) => {
      expect(isStockMovementType(value)).toBe(false);
      expect(() => assertStockMovementType(value)).toThrow(ValidationError);
    },
  );

  it('maps types to the documented sign conventions', () => {
    expect(stockMovementDelta('IN')).toBe(1);
    expect(stockMovementDelta('ADJUSTMENT')).toBe(1);
    expect(stockMovementDelta('OUT')).toBe(-1);
    // TRANSFER is a two-branch operation, not a single-balance delta.
    expect(stockMovementDelta('TRANSFER')).toBe(0);
  });
});
