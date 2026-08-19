import { describe, it, expect } from 'vitest';
import { BrandColor } from './brand-color.js';
import { ValidationError } from '@domain/errors/index.js';

describe('BrandColor', () => {
  it('accepts a 6-digit hex and normalises to lower-case', () => {
    expect(BrandColor.create('#FF00AA').value).toBe('#ff00aa');
  });

  it('trims surrounding whitespace', () => {
    expect(BrandColor.create('  #1A2B3C  ').value).toBe('#1a2b3c');
  });

  it('expands the 3-digit shorthand to its 6-digit form', () => {
    expect(BrandColor.create('#f0a').value).toBe('#ff00aa');
    expect(BrandColor.create('#ABC').value).toBe('#aabbcc');
  });

  it('treats equivalent inputs as structurally equal', () => {
    expect(BrandColor.create('#FFF').equals(BrandColor.create('#ffffff'))).toBe(true);
  });

  it.each(['', '   ', 'ff00aa', '#12', '#12345', '#gggggg', '#1234567', 'red'])(
    'rejects the malformed color %j',
    (value) => {
      expect(() => BrandColor.create(value)).toThrow(ValidationError);
    },
  );

  it('rejects a non-string value', () => {
    expect(() => BrandColor.create(123 as unknown as string)).toThrow(ValidationError);
  });
});
