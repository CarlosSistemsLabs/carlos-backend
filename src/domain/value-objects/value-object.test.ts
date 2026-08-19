import { describe, it, expect } from 'vitest';
import { ValueObject } from './value-object.js';

interface MoneyProps {
  amount: number;
  currency: string;
}

class Money extends ValueObject<MoneyProps> {
  constructor(props: MoneyProps) {
    super(props);
  }

  static of(amount: number, currency: string): Money {
    return new Money({ amount, currency });
  }

  get amount(): number {
    return this.props.amount;
  }
}

describe('ValueObject', () => {
  it('considers value objects with the same attributes equal', () => {
    const a = Money.of(100, 'ARS');
    const b = Money.of(100, 'ARS');
    expect(a.equals(b)).toBe(true);
  });

  it('ignores attribute insertion order when comparing', () => {
    const a = new Money({ amount: 100, currency: 'ARS' });
    const b = new Money({ currency: 'ARS', amount: 100 });
    expect(a.equals(b)).toBe(true);
  });

  it('considers value objects with different attributes not equal', () => {
    expect(Money.of(100, 'ARS').equals(Money.of(200, 'ARS'))).toBe(false);
    expect(Money.of(100, 'ARS').equals(Money.of(100, 'USD'))).toBe(false);
  });

  it('is equal to itself', () => {
    const a = Money.of(100, 'ARS');
    expect(a.equals(a)).toBe(true);
  });

  it('is not equal to null or undefined', () => {
    const a = Money.of(100, 'ARS');
    expect(a.equals(null)).toBe(false);
    expect(a.equals(undefined)).toBe(false);
  });

  it('is immutable (attributes are frozen)', () => {
    const a = Money.of(100, 'ARS');
    expect(Object.isFrozen((a as unknown as { props: MoneyProps }).props)).toBe(
      true,
    );
    expect(() => {
      (a as unknown as { props: MoneyProps }).props.amount = 999;
    }).toThrow();
  });
});
