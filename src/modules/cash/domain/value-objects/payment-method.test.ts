import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import { PAYMENT_METHODS, assertPaymentMethod, isPaymentMethod } from './payment-method.js';

describe('PaymentMethod', () => {
  it('recognises the four supported tenders', () => {
    expect(PAYMENT_METHODS).toEqual(['cash', 'card', 'transfer', 'check']);
    for (const method of PAYMENT_METHODS) {
      expect(isPaymentMethod(method)).toBe(true);
    }
    expect(isPaymentMethod('crypto')).toBe(false);
    expect(isPaymentMethod('CASH')).toBe(false);
  });

  it('asserts valid methods and throws on invalid', () => {
    expect(assertPaymentMethod('transfer')).toBe('transfer');
    expect(() => assertPaymentMethod('bitcoin')).toThrow(ValidationError);
  });
});
