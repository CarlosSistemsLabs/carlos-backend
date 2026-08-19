import { describe, it, expect } from 'vitest';
import { Email } from './email.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Email', () => {
  it('accepts a well-formed address', () => {
    const email = Email.create('user@example.com');
    expect(email.value).toBe('user@example.com');
  });

  it('normalises by trimming and lower-casing', () => {
    const email = Email.create('  User@Example.COM  ');
    expect(email.value).toBe('user@example.com');
  });

  it('is value-equal when normalised values match', () => {
    expect(Email.create('a@b.com').equals(Email.create('A@B.COM'))).toBe(true);
  });

  it.each(['', '   ', 'no-at-symbol', 'a@b', 'a@@b.com', 'a b@c.com'])(
    'rejects malformed value %j',
    (value) => {
      expect(() => Email.create(value)).toThrow(ValidationError);
    },
  );

  it('rejects addresses exceeding the maximum length', () => {
    const long = `${'a'.repeat(250)}@example.com`;
    expect(() => Email.create(long)).toThrow(ValidationError);
  });
});
