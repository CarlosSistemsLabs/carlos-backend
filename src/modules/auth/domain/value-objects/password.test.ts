import { describe, it, expect } from 'vitest';
import { Password } from './password.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Password', () => {
  it('accepts a policy-compliant password', () => {
    const password = Password.create('Str0ngPass');
    expect(password.value).toBe('Str0ngPass');
  });

  it.each([
    ['too short', 'Ab1'],
    ['missing lower-case', 'PASSWORD1'],
    ['missing upper-case', 'password1'],
    ['missing digit', 'Password'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(() => Password.create(value)).toThrow(ValidationError);
  });

  it('rejects a password exceeding the maximum length', () => {
    const value = `Aa1${'x'.repeat(Password.MAX_LENGTH)}`;
    expect(() => Password.create(value)).toThrow(ValidationError);
  });
});
