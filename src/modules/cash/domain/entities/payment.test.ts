import { describe, it, expect } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { ValidationError } from '@domain/errors/index.js';
import { Payment } from './payment.js';
import { InvalidPaymentLinkError, NonPositiveAmountError } from '../errors/cash-errors.js';

const amount = Money.fromDecimal('100.00', 'ARS');

describe('Payment', () => {
  it('creates a sale payment linked to exactly one sale', () => {
    const payment = Payment.create({
      tenantId: 't1',
      saleId: 's1',
      method: 'card',
      amount,
      reference: 'auth-123',
    });
    expect(payment.saleId).toBe('s1');
    expect(payment.purchaseId).toBeNull();
    expect(payment.isSalePayment).toBe(true);
    expect(payment.isPurchasePayment).toBe(false);
    expect(payment.method).toBe('card');
    expect(payment.amount.toDecimalString()).toBe('100.00');
  });

  it('creates a purchase payment linked to exactly one purchase', () => {
    const payment = Payment.create({
      tenantId: 't1',
      purchaseId: 'p1',
      method: 'transfer',
      amount,
    });
    expect(payment.purchaseId).toBe('p1');
    expect(payment.saleId).toBeNull();
    expect(payment.isPurchasePayment).toBe(true);
  });

  it('rejects a payment linked to both a sale and a purchase', () => {
    expect(() =>
      Payment.create({ tenantId: 't1', saleId: 's1', purchaseId: 'p1', method: 'cash', amount }),
    ).toThrow(InvalidPaymentLinkError);
  });

  it('rejects a payment linked to neither a sale nor a purchase', () => {
    expect(() => Payment.create({ tenantId: 't1', method: 'cash', amount })).toThrow(
      InvalidPaymentLinkError,
    );
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      Payment.create({ tenantId: 't1', saleId: 's1', method: 'cash', amount: Money.zero('ARS') }),
    ).toThrow(NonPositiveAmountError);
  });

  it('rejects an invalid method', () => {
    expect(() =>
      Payment.create({ tenantId: 't1', saleId: 's1', method: 'crypto' as never, amount }),
    ).toThrow(ValidationError);
  });

  it('reconstitutes without re-validation', () => {
    const payment = Payment.reconstitute('pay-1', {
      tenantId: 't1',
      saleId: 's1',
      purchaseId: null,
      method: 'check',
      amount,
      reference: null,
      date: new Date('2024-02-02T00:00:00.000Z'),
    });
    expect(payment.id).toBe('pay-1');
    expect(payment.method).toBe('check');
  });
});
