import { describe, it, expect } from 'vitest';
import { Email, EMAIL_MAX_LENGTH } from './email.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Email', () => {
  it('normalises to trimmed, lower-case form', () => {
    const email = Email.create('  User@Example.COM  ');
    expect(email.value).toBe('user@example.com');
    expect(email.toString()).toBe('user@example.com');
  });

  it('treats equivalent addresses as equal (value-based)', () => {
    expect(Email.create('a@b.com').equals(Email.create('A@B.COM'))).toBe(true);
  });

  it.each(['', '   ', 'no-at-symbol', 'missing@tld', '@nolocal.com', 'spaces in@a.com'])(
    'rejects malformed address %j',
    (value) => {
      expect(() => Email.create(value)).toThrow(ValidationError);
    },
  );

  it('rejects an address exceeding the maximum length', () => {
    const local = 'a'.repeat(EMAIL_MAX_LENGTH);
    expect(() => Email.create(`${local}@example.com`)).toThrow(ValidationError);
  });

  it('rejects non-string input', () => {
    expect(() => Email.create(undefined as unknown as string)).toThrow(ValidationError);
  });
});
