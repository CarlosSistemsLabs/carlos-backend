import { describe, it, expect } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { derivePaymentStatus, PAYMENT_STATUSES } from './payment-status.js';

const CURRENCY = 'ARS';
const money = (v: string): Money => Money.fromDecimal(v, CURRENCY);

describe('derivePaymentStatus', () => {
  it('is unpaid when nothing has been paid', () => {
    expect(derivePaymentStatus(money('100.00'), money('0.00'))).toBe('unpaid');
  });

  it('is partial when some but not all is paid', () => {
    expect(derivePaymentStatus(money('100.00'), money('99.99'))).toBe('partial');
    expect(derivePaymentStatus(money('100.00'), money('0.01'))).toBe('partial');
  });

  it('is paid when the total is exactly met', () => {
    expect(derivePaymentStatus(money('100.00'), money('100.00'))).toBe('paid');
  });

  it('is paid when the paid amount exceeds the total', () => {
    expect(derivePaymentStatus(money('100.00'), money('120.00'))).toBe('paid');
  });

  it('treats a zero-total document as paid', () => {
    expect(derivePaymentStatus(money('0.00'), money('0.00'))).toBe('paid');
  });

  it('only ever returns a known status', () => {
    const status = derivePaymentStatus(money('50.00'), money('25.00'));
    expect(PAYMENT_STATUSES).toContain(status);
  });
});
