import { describe, it, expect } from 'vitest';
import { SaleDetail } from './sale-detail.js';
import { InvalidSaleQuantityError } from '../errors/sale-errors.js';
import { ValidationError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';

const price = (v: string): Money => Money.fromDecimal(v, 'ARS');

describe('SaleDetail', () => {
  describe('pricing math', () => {
    it('computes subtotal = unitPrice * quantity', () => {
      const line = SaleDetail.create({ productId: 'p1', quantity: 3, unitPrice: price('10.00') });
      expect(line.subtotal.toDecimalString()).toBe('30.00');
    });

    it('computes taxAmount = subtotal * taxRate / 100 and total = subtotal + tax', () => {
      const line = SaleDetail.create({
        productId: 'p1',
        quantity: 2,
        unitPrice: price('100.00'),
        taxRate: 21,
      });
      expect(line.subtotal.toDecimalString()).toBe('200.00');
      expect(line.taxAmount.toDecimalString()).toBe('42.00');
      expect(line.total.toDecimalString()).toBe('242.00');
    });

    it('defaults tax rate to 0 (total equals subtotal)', () => {
      const line = SaleDetail.create({ productId: 'p1', quantity: 5, unitPrice: price('9.99') });
      expect(line.taxAmount.toDecimalString()).toBe('0.00');
      expect(line.total.toDecimalString()).toBe('49.95');
    });

    it('rounds tax half-up to the minor unit without float drift', () => {
      // 3 * 3.33 = 9.99; 10.5% tax = 1.04895 -> rounds to 1.05
      const line = SaleDetail.create({
        productId: 'p1',
        quantity: 3,
        unitPrice: price('3.33'),
        taxRate: 10.5,
      });
      expect(line.subtotal.toDecimalString()).toBe('9.99');
      expect(line.taxAmount.toDecimalString()).toBe('1.05');
      expect(line.total.toDecimalString()).toBe('11.04');
    });
  });

  describe('validation', () => {
    it('rejects a non-positive quantity', () => {
      expect(() => SaleDetail.create({ productId: 'p1', quantity: 0, unitPrice: price('1.00') })).toThrow(
        InvalidSaleQuantityError,
      );
      expect(() => SaleDetail.create({ productId: 'p1', quantity: -2, unitPrice: price('1.00') })).toThrow(
        InvalidSaleQuantityError,
      );
    });

    it('rejects a non-integer quantity', () => {
      expect(() => SaleDetail.create({ productId: 'p1', quantity: 1.5, unitPrice: price('1.00') })).toThrow(
        InvalidSaleQuantityError,
      );
    });

    it('rejects a tax rate outside [0, 100]', () => {
      expect(() =>
        SaleDetail.create({ productId: 'p1', quantity: 1, unitPrice: price('1.00'), taxRate: -1 }),
      ).toThrow(ValidationError);
      expect(() =>
        SaleDetail.create({ productId: 'p1', quantity: 1, unitPrice: price('1.00'), taxRate: 101 }),
      ).toThrow(ValidationError);
    });
  });

  describe('reconstitute', () => {
    it('rebuilds a line from persisted state, preserving id', () => {
      const line = SaleDetail.reconstitute('line-1', {
        productId: 'p1',
        quantity: 4,
        unitPrice: price('2.50'),
        taxRate: 0,
      });
      expect(line.id).toBe('line-1');
      expect(line.subtotal.toDecimalString()).toBe('10.00');
    });
  });
});
