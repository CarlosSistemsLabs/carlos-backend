import { describe, it, expect } from 'vitest';
import { Phone } from './phone.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Phone', () => {
  it('strips formatting characters while preserving a leading +', () => {
    expect(Phone.create('+54 11 1234-5678').value).toBe('+541112345678');
    expect(Phone.create('(011) 4321.9876').value).toBe('01143219876');
  });

  it('treats equivalently-formatted numbers as equal', () => {
    expect(Phone.create('+54 11 1234 5678').equals(Phone.create('+541112345678'))).toBe(true);
  });

  it('rejects numbers with too few or too many digits', () => {
    expect(() => Phone.create('12345')).toThrow(ValidationError);
    expect(() => Phone.create('1234567890123456')).toThrow(ValidationError);
  });

  it.each(['', '   ', 'abc1234', '12-34-ext'])('rejects invalid input %j', (value) => {
    expect(() => Phone.create(value)).toThrow(ValidationError);
  });

  it('accepts a number at the minimum digit boundary', () => {
    expect(Phone.create('1234567').value).toBe('1234567');
  });
});
