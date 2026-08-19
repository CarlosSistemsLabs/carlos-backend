import { describe, it, expect } from 'vitest';
import { Sku, SKU_MAX_LENGTH } from './sku.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Sku', () => {
  it('creates a SKU and normalises it (trim + upper-case)', () => {
    const sku = Sku.create('  abc-123 ');
    expect(sku.value).toBe('ABC-123');
    expect(sku.toString()).toBe('ABC-123');
  });

  it('allows letters, digits, hyphen and underscore', () => {
    expect(Sku.create('PROD_01-A').value).toBe('PROD_01-A');
  });

  it('uses value-based equality after normalisation', () => {
    expect(Sku.create('abc1').equals(Sku.create(' ABC1 '))).toBe(true);
    expect(Sku.create('abc1').equals(Sku.create('abc2'))).toBe(false);
  });

  it.each(['', '   '])('rejects empty SKU "%s"', (value) => {
    expect(() => Sku.create(value)).toThrow(ValidationError);
  });

  it.each(['ab c', 'abc!', '-abc', '_abc', 'a.b'])(
    'rejects malformed SKU "%s"',
    (value) => {
      expect(() => Sku.create(value)).toThrow(ValidationError);
    },
  );

  it('rejects a SKU longer than the maximum length', () => {
    expect(() => Sku.create('A'.repeat(SKU_MAX_LENGTH + 1))).toThrow(ValidationError);
    expect(Sku.create('A'.repeat(SKU_MAX_LENGTH)).value.length).toBe(SKU_MAX_LENGTH);
  });
});
