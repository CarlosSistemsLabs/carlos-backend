import { describe, it, expect } from 'vitest';
import { Stock } from './stock.js';
import { InsufficientStockError } from '../errors/stock-errors.js';
import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';

function makeStock(quantity = 0): Stock {
  return Stock.create({ tenantId: 'tenant-1', productId: 'prod-1', branchId: null, quantity });
}

describe('Stock', () => {
  describe('create', () => {
    it('opens a balance with the given quantity and defaults branchId to null', () => {
      const stock = Stock.create({ tenantId: 't', productId: 'p', quantity: 5 });
      expect(stock.quantity).toBe(5);
      expect(stock.branchId).toBeNull();
      expect(stock.tenantId).toBe('t');
      expect(stock.productId).toBe('p');
    });

    it('defaults quantity to zero', () => {
      expect(makeStock().quantity).toBe(0);
    });

    it.each([-1, 1.5, Number.NaN])('rejects invalid opening quantity %p', (q) => {
      expect(() => Stock.create({ tenantId: 't', productId: 'p', quantity: q })).toThrow(
        ValidationError,
      );
    });
  });

  describe('increase', () => {
    it('adds units to the balance', () => {
      const stock = makeStock(10);
      stock.increase(5);
      expect(stock.quantity).toBe(15);
    });

    it.each([0, -3, 2.5])('rejects a non-positive/non-integer amount %p', (q) => {
      expect(() => makeStock(10).increase(q)).toThrow(ValidationError);
    });
  });

  describe('decrease', () => {
    it('removes units from the balance', () => {
      const stock = makeStock(10);
      stock.decrease(4);
      expect(stock.quantity).toBe(6);
    });

    it('allows decreasing exactly to zero', () => {
      const stock = makeStock(10);
      stock.decrease(10);
      expect(stock.quantity).toBe(0);
    });

    it('throws InsufficientStockError when it would go below zero', () => {
      const stock = makeStock(3);
      expect(() => stock.decrease(4)).toThrow(InsufficientStockError);
      // balance is left unchanged after a rejected decrease
      expect(stock.quantity).toBe(3);
    });

    it.each([0, -1, 1.2])('rejects a non-positive/non-integer amount %p', (q) => {
      expect(() => makeStock(10).decrease(q)).toThrow(ValidationError);
    });
  });

  describe('applyMovement', () => {
    it('increases on IN and ADJUSTMENT', () => {
      const stock = makeStock(1);
      stock.applyMovement('IN', 2);
      stock.applyMovement('ADJUSTMENT', 3);
      expect(stock.quantity).toBe(6);
    });

    it('decreases on OUT, guarding against negative balances', () => {
      const stock = makeStock(5);
      stock.applyMovement('OUT', 5);
      expect(stock.quantity).toBe(0);
      expect(() => stock.applyMovement('OUT', 1)).toThrow(InsufficientStockError);
    });

    it('rejects TRANSFER as a single-balance operation', () => {
      expect(() => makeStock(5).applyMovement('TRANSFER', 1)).toThrow(BusinessRuleError);
    });
  });

  describe('isLow', () => {
    it('flags quantities at or below the threshold', () => {
      const stock = makeStock(5);
      expect(stock.isLow(5)).toBe(true);
      expect(stock.isLow(6)).toBe(true);
      expect(stock.isLow(4)).toBe(false);
    });
  });

  describe('reconstitute', () => {
    it('rehydrates persisted state without re-validation', () => {
      const stock = Stock.reconstitute('stock-1', {
        tenantId: 't',
        productId: 'p',
        branchId: 'b',
        quantity: 42,
      });
      expect(stock.id).toBe('stock-1');
      expect(stock.branchId).toBe('b');
      expect(stock.quantity).toBe(42);
    });
  });
});
