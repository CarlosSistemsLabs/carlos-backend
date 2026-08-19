import { describe, it, expect } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { ValidationError } from '@domain/errors/index.js';
import { CashMovement } from './cash-movement.js';
import { NonPositiveAmountError } from '../errors/cash-errors.js';

const base = {
  cashId: 'cash-1',
  tenantId: 't1',
  userId: 'u1',
} as const;

describe('CashMovement', () => {
  it('creates a valid INCOME movement with a positive amount', () => {
    const movement = CashMovement.create({
      ...base,
      type: 'INCOME',
      category: 'sale',
      amount: Money.fromDecimal('100.00', 'ARS'),
      reference: 'sale:1',
    });
    expect(movement.type).toBe('INCOME');
    expect(movement.category).toBe('sale');
    expect(movement.amount.toDecimalString()).toBe('100.00');
    expect(movement.reference).toBe('sale:1');
    expect(movement.description).toBeNull();
    expect(movement.date).toBeInstanceOf(Date);
  });

  it('rejects a zero or negative amount', () => {
    expect(() =>
      CashMovement.create({
        ...base,
        type: 'INCOME',
        category: 'other',
        amount: Money.zero('ARS'),
      }),
    ).toThrow(NonPositiveAmountError);
    expect(() =>
      CashMovement.create({
        ...base,
        type: 'EXPENSE',
        category: 'other',
        amount: Money.fromDecimal('-5.00', 'ARS'),
      }),
    ).toThrow(NonPositiveAmountError);
  });

  it('rejects an invalid type or category', () => {
    expect(() =>
      CashMovement.create({
        ...base,
        type: 'REFUND' as never,
        category: 'other',
        amount: Money.fromDecimal('1.00', 'ARS'),
      }),
    ).toThrow(ValidationError);
    expect(() =>
      CashMovement.create({
        ...base,
        type: 'INCOME',
        category: 'deposit' as never,
        amount: Money.fromDecimal('1.00', 'ARS'),
      }),
    ).toThrow(ValidationError);
  });

  it('exposes a signed amount reflecting the direction', () => {
    const income = CashMovement.create({
      ...base,
      type: 'INCOME',
      category: 'opening',
      amount: Money.fromDecimal('50.00', 'ARS'),
    });
    const expense = CashMovement.create({
      ...base,
      type: 'EXPENSE',
      category: 'purchase',
      amount: Money.fromDecimal('30.00', 'ARS'),
    });
    expect(income.signedAmount.toDecimalString()).toBe('50.00');
    expect(expense.signedAmount.toDecimalString()).toBe('-30.00');
  });

  it('reconstitutes without re-validation', () => {
    const movement = CashMovement.reconstitute('m1', {
      cashId: 'cash-1',
      tenantId: 't1',
      userId: 'u1',
      type: 'EXPENSE',
      category: 'closing',
      amount: Money.fromDecimal('10.00', 'ARS'),
      reference: null,
      description: 'shortage',
      date: new Date('2024-01-01T00:00:00.000Z'),
    });
    expect(movement.id).toBe('m1');
    expect(movement.description).toBe('shortage');
  });
});
