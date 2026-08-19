import { describe, expect, it } from 'vitest';
import { escapeCsvField, toCsv } from './csv.js';

describe('escapeCsvField', () => {
  it('leaves a plain value unquoted', () => {
    expect(escapeCsvField('hello')).toBe('hello');
  });

  it('stringifies a number without quoting', () => {
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(0)).toBe('0');
    expect(escapeCsvField(-3.5)).toBe('-3.5');
  });

  it('leaves an empty string unquoted', () => {
    expect(escapeCsvField('')).toBe('');
  });

  it('quotes a value containing a comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('quotes and doubles embedded double quotes', () => {
    expect(escapeCsvField('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('quotes a value that is only a double quote', () => {
    expect(escapeCsvField('"')).toBe('""""');
  });

  it('quotes a value containing a newline (LF)', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes a value containing a carriage return (CR)', () => {
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('quotes a value containing a CRLF sequence', () => {
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('quotes a value with both a comma and a quote', () => {
    expect(escapeCsvField('a,"b"')).toBe('"a,""b"""');
  });
});

describe('toCsv', () => {
  it('serialises a header row plus data rows separated by CRLF', () => {
    const csv = toCsv([
      ['name', 'qty'],
      ['apple', 3],
      ['pear', 5],
    ]);
    expect(csv).toBe('name,qty\r\napple,3\r\npear,5');
  });

  it('returns an empty string for an empty grid', () => {
    expect(toCsv([])).toBe('');
  });

  it('serialises a single row without a trailing separator', () => {
    expect(toCsv([['a', 'b', 'c']])).toBe('a,b,c');
  });

  it('escapes fields that contain delimiters, quotes and newlines', () => {
    const csv = toCsv([
      ['label', 'note'],
      ['Widget, Deluxe', 'has "quotes"'],
      ['Multi\nline', 'plain'],
    ]);
    expect(csv).toBe(
      'label,note\r\n"Widget, Deluxe","has ""quotes"""\r\n"Multi\nline",plain',
    );
  });

  it('preserves empty cells as empty (unquoted) fields', () => {
    expect(toCsv([['a', '', 'c']])).toBe('a,,c');
  });
});
