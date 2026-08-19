import { describe, it, expect } from 'vitest';
import { Money, MONEY_DECIMAL_PLACES } from './money.js';
import { ValidationError } from '@domain/errors/index.js';
import { CurrencyMismatchError } from '../errors/product-errors.js';

describe('Money', () => {
  describe('construction', () => {
    it('creates from minor units and exposes both minor and major amounts', () => {
      const money = Money.fromMinorUnits(1250, 'ars');
      expect(money.amountMinor).toBe(1250);
      expect(money.amount).toBe(12.5);
      expect(money.currency).toBe('ARS'); // normalised to upper-case
    });

    it('creates from a decimal number', () => {
      const money = Money.fromDecimal(12.5, 'USD');
      expect(money.amountMinor).toBe(1250);
      expect(money.toDecimalString()).toBe('12.50');
    });

    it('creates from a decimal string without floating-point drift', () => {
      const money = Money.fromDecimal('0.10', 'USD');
      expect(money.amountMinor).toBe(10);
    });

    it('rounds fractional digits beyond the supported precision (half-up)', () => {
      expect(Money.fromDecimal('1.005', 'USD').amountMinor).toBe(101);
      expect(Money.fromDecimal('1.004', 'USD').amountMinor).toBe(100);
    });

    it('supports negative amounts', () => {
      const money = Money.fromDecimal('-3.25', 'USD');
      expect(money.amountMinor).toBe(-325);
      expect(money.toDecimalString()).toBe('-3.25');
      expect(money.isNegative()).toBe(true);
    });

    it('creates a zero amount', () => {
      const money = Money.zero('USD');
      expect(money.isZero()).toBe(true);
      expect(money.amountMinor).toBe(0);
    });

    it('tracks two decimal places by default', () => {
      expect(MONEY_DECIMAL_PLACES).toBe(2);
    });
  });

  describe('validation', () => {
    it.each(['us', 'usdd', '12$', ''])('rejects invalid currency code "%s"', (currency) => {
      expect(() => Money.fromMinorUnits(100, currency)).toThrow(ValidationError);
    });

    it('rejects non-integer minor units', () => {
      expect(() => Money.fromMinorUnits(10.5, 'USD')).toThrow(ValidationError);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'rejects non-finite numeric amount %s',
      (value) => {
        expect(() => Money.fromDecimal(value, 'USD')).toThrow(ValidationError);
      },
    );

    it.each(['abc', '1.2.3', '', '  ', '1,5'])(
      'rejects invalid decimal string "%s"',
      (value) => {
        expect(() => Money.fromDecimal(value, 'USD')).toThrow(ValidationError);
      },
    );
  });

  describe('no float drift', () => {
    it('handles the classic 0.1 + 0.2 === 0.3 case exactly', () => {
      const result = Money.fromDecimal(0.1, 'USD').add(Money.fromDecimal(0.2, 'USD'));
      expect(result.equals(Money.fromDecimal(0.3, 'USD'))).toBe(true);
      expect(result.amountMinor).toBe(30);
    });

    it('accumulates repeated additions without drift', () => {
      let total = Money.zero('USD');
      for (let i = 0; i < 10; i += 1) {
        total = total.add(Money.fromDecimal('0.10', 'USD'));
      }
      expect(total.amountMinor).toBe(100);
      expect(total.toDecimalString()).toBe('1.00');
    });
  });

  describe('arithmetic', () => {
    it('adds two amounts of the same currency', () => {
      const result = Money.fromDecimal('5.00', 'USD').add(Money.fromDecimal('2.50', 'USD'));
      expect(result.toDecimalString()).toBe('7.50');
    });

    it('subtracts two amounts of the same currency', () => {
      const result = Money.fromDecimal('5.00', 'USD').subtract(Money.fromDecimal('2.50', 'USD'));
      expect(result.toDecimalString()).toBe('2.50');
    });

    it('multiplies by a quantity', () => {
      const result = Money.fromDecimal('1.99', 'USD').multiply(3);
      expect(result.toDecimalString()).toBe('5.97');
    });

    it('multiplies by a fractional factor, rounding half-up', () => {
      const result = Money.fromDecimal('10.00', 'USD').multiply(0.215);
      expect(result.amountMinor).toBe(215);
    });

    it('rejects a non-finite multiplier', () => {
      expect(() => Money.fromDecimal('1.00', 'USD').multiply(Number.NaN)).toThrow(ValidationError);
    });

    it.each<[string, (a: Money, b: Money) => unknown]>([
      ['add', (a, b) => a.add(b)],
      ['subtract', (a, b) => a.subtract(b)],
      ['compare', (a, b) => a.compare(b)],
    ])('rejects %s across different currencies', (_name, op) => {
      const usd = Money.fromDecimal('1.00', 'USD');
      const ars = Money.fromDecimal('1.00', 'ARS');
      expect(() => op(usd, ars)).toThrow(CurrencyMismatchError);
    });
  });

  describe('equality and comparison', () => {
    it('uses value-based equality', () => {
      expect(Money.fromDecimal('1.00', 'USD').equals(Money.fromMinorUnits(100, 'USD'))).toBe(true);
      expect(Money.fromDecimal('1.00', 'USD').equals(Money.fromDecimal('1.00', 'ARS'))).toBe(false);
      expect(Money.fromDecimal('1.00', 'USD').equals(Money.fromDecimal('2.00', 'USD'))).toBe(false);
    });

    it('compares amounts of the same currency', () => {
      const one = Money.fromDecimal('1.00', 'USD');
      const two = Money.fromDecimal('2.00', 'USD');
      expect(one.compare(two)).toBeLessThan(0);
      expect(two.compare(one)).toBeGreaterThan(0);
      expect(one.compare(Money.fromDecimal('1.00', 'USD'))).toBe(0);
      expect(two.greaterThan(one)).toBe(true);
      expect(one.lessThan(two)).toBe(true);
    });

    it('reports positivity/negativity/zero', () => {
      expect(Money.fromDecimal('1.00', 'USD').isPositive()).toBe(true);
      expect(Money.fromDecimal('-1.00', 'USD').isNegative()).toBe(true);
      expect(Money.zero('USD').isZero()).toBe(true);
    });
  });

  describe('serialisation', () => {
    it('renders a canonical decimal string with padded fraction', () => {
      expect(Money.fromMinorUnits(5, 'USD').toDecimalString()).toBe('0.05');
      expect(Money.fromMinorUnits(1000, 'USD').toDecimalString()).toBe('10.00');
    });

    it('renders an "amount currency" string', () => {
      expect(Money.fromDecimal('12.5', 'ARS').toString()).toBe('12.50 ARS');
    });

    it('is immutable across operations (returns new instances)', () => {
      const original = Money.fromDecimal('5.00', 'USD');
      const added = original.add(Money.fromDecimal('1.00', 'USD'));
      expect(original.toDecimalString()).toBe('5.00');
      expect(added.toDecimalString()).toBe('6.00');
      expect(added).not.toBe(original);
    });
  });
});
