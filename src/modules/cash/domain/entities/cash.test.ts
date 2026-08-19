import { describe, it, expect } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { ValidationError } from '@domain/errors/index.js';
import { Cash } from './cash.js';
import { CashMovement } from './cash-movement.js';
import { CashMovementMismatchError, InsufficientCashBalanceError } from '../errors/cash-errors.js';

function money(value: string, currency = 'ARS'): Money {
  return Money.fromDecimal(value, currency);
}

function movement(
  cashId: string,
  type: 'INCOME' | 'EXPENSE',
  amount: string,
  currency = 'ARS',
): CashMovement {
  return CashMovement.create({
    cashId,
    tenantId: 't1',
    userId: 'u1',
    type,
    category: 'other',
    amount: money(amount, currency),
  });
}

describe('Cash', () => {
  describe('create', () => {
    it('opens a register with a zero balance by default', () => {
      const cash = Cash.create({ tenantId: 't1', name: 'Main', currency: 'ARS' });
      expect(cash.name).toBe('Main');
      expect(cash.branchId).toBeNull();
      expect(cash.balance.toDecimalString()).toBe('0.00');
      expect(cash.currency).toBe('ARS');
    });

    it('trims the name and rejects a blank name', () => {
      expect(Cash.create({ tenantId: 't1', name: '  Front  ', currency: 'ARS' }).name).toBe(
        'Front',
      );
      expect(() => Cash.create({ tenantId: 't1', name: '   ', currency: 'ARS' })).toThrow(
        ValidationError,
      );
    });

    it('rejects a negative starting balance', () => {
      expect(() =>
        Cash.create({ tenantId: 't1', name: 'Main', currency: 'ARS', balance: money('-1.00') }),
      ).toThrow(ValidationError);
    });
  });

  describe('applyMovement', () => {
    it('credits an INCOME and debits an EXPENSE', () => {
      const cash = Cash.create({ tenantId: 't1', name: 'Main', currency: 'ARS' });
      cash.applyMovement(movement(cash.id, 'INCOME', '100.00'));
      expect(cash.balance.toDecimalString()).toBe('100.00');
      cash.applyMovement(movement(cash.id, 'EXPENSE', '30.00'));
      expect(cash.balance.toDecimalString()).toBe('70.00');
    });

    it('allows an EXPENSE that draws the balance exactly to zero', () => {
      const cash = Cash.create({
        tenantId: 't1',
        name: 'Main',
        currency: 'ARS',
        balance: money('50.00'),
      });
      cash.applyMovement(movement(cash.id, 'EXPENSE', '50.00'));
      expect(cash.balance.toDecimalString()).toBe('0.00');
    });

    it('rejects an EXPENSE that would overdraw the register', () => {
      const cash = Cash.create({
        tenantId: 't1',
        name: 'Main',
        currency: 'ARS',
        balance: money('20.00'),
      });
      expect(() => cash.applyMovement(movement(cash.id, 'EXPENSE', '20.01'))).toThrow(
        InsufficientCashBalanceError,
      );
      // Balance is unchanged after a rejected movement.
      expect(cash.balance.toDecimalString()).toBe('20.00');
    });

    it('rejects a movement belonging to another register', () => {
      const cash = Cash.create({ tenantId: 't1', name: 'Main', currency: 'ARS' });
      expect(() => cash.applyMovement(movement('other-cash', 'INCOME', '10.00'))).toThrow(
        CashMovementMismatchError,
      );
    });

    it('rejects a movement in a different currency', () => {
      const cash = Cash.create({ tenantId: 't1', name: 'Main', currency: 'ARS' });
      expect(() => cash.applyMovement(movement(cash.id, 'INCOME', '10.00', 'USD'))).toThrow(
        ValidationError,
      );
    });
  });

  describe('reconcile', () => {
    it('reports a clean count as a zero difference', () => {
      const cash = Cash.create({
        tenantId: 't1',
        name: 'Main',
        currency: 'ARS',
        balance: money('250.00'),
      });
      const result = cash.reconcile(money('250.00'));
      expect(result.expected.toDecimalString()).toBe('250.00');
      expect(result.counted.toDecimalString()).toBe('250.00');
      expect(result.difference.toDecimalString()).toBe('0.00');
    });

    it('reports an overage as a positive difference', () => {
      const cash = Cash.create({
        tenantId: 't1',
        name: 'Main',
        currency: 'ARS',
        balance: money('100.00'),
      });
      expect(cash.reconcile(money('120.00')).difference.toDecimalString()).toBe('20.00');
    });

    it('reports a shortage as a negative difference', () => {
      const cash = Cash.create({
        tenantId: 't1',
        name: 'Main',
        currency: 'ARS',
        balance: money('100.00'),
      });
      expect(cash.reconcile(money('85.50')).difference.toDecimalString()).toBe('-14.50');
    });

    it('does not mutate the register', () => {
      const cash = Cash.create({
        tenantId: 't1',
        name: 'Main',
        currency: 'ARS',
        balance: money('100.00'),
      });
      cash.reconcile(money('120.00'));
      expect(cash.balance.toDecimalString()).toBe('100.00');
    });

    it('rejects a counted amount in a different currency', () => {
      const cash = Cash.create({ tenantId: 't1', name: 'Main', currency: 'ARS' });
      expect(() => cash.reconcile(money('10.00', 'USD'))).toThrow(ValidationError);
    });
  });

  it('applying a ledger of movements matches a direct balance sum (integer-safe math)', () => {
    const cash = Cash.create({ tenantId: 't1', name: 'Main', currency: 'ARS' });
    const incomes = ['0.10', '0.20', '10.05', '99.99'];
    const expenses = ['5.55', '4.44'];
    for (const amount of incomes) {
      cash.applyMovement(movement(cash.id, 'INCOME', amount));
    }
    for (const amount of expenses) {
      cash.applyMovement(movement(cash.id, 'EXPENSE', amount));
    }
    // 0.10+0.20+10.05+99.99 - 5.55 - 4.44 = 100.35
    expect(cash.balance.toDecimalString()).toBe('100.35');
  });
});
