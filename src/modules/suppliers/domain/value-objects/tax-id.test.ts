import { describe, it, expect } from 'vitest';
import { TaxId, TAX_ID_MAX_LENGTH } from './tax-id.js';
import { ValidationError } from '@domain/errors/index.js';

describe('TaxId', () => {
  it('normalises to trimmed, upper-case form', () => {
    const taxId = TaxId.create('  20-12345678-9  ');
    expect(taxId.value).toBe('20-12345678-9');
  });

  it('upper-cases alphabetic identifiers and compares by value', () => {
    expect(TaxId.create('gb123456789').equals(TaxId.create('GB123456789'))).toBe(true);
  });

  it.each(['', '   ', 'ab', 'has spaces', 'bad$char'])('rejects invalid input %j', (value) => {
    expect(() => TaxId.create(value)).toThrow(ValidationError);
  });

  it('rejects an identifier exceeding the maximum length', () => {
    expect(() => TaxId.create('1'.repeat(TAX_ID_MAX_LENGTH + 1))).toThrow(ValidationError);
  });
});
