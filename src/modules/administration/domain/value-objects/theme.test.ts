import { describe, it, expect } from 'vitest';
import { Theme, THEMES } from './theme.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Theme', () => {
  it('accepts the supported themes (case-insensitive, trimmed)', () => {
    expect(Theme.create('light').value).toBe(THEMES.LIGHT);
    expect(Theme.create('  DARK ').value).toBe(THEMES.DARK);
  });

  it('exposes canonical factories', () => {
    expect(Theme.light().value).toBe('light');
    expect(Theme.dark().value).toBe('dark');
  });

  it('treats equivalent inputs as structurally equal', () => {
    expect(Theme.create('LIGHT').equals(Theme.light())).toBe(true);
  });

  it.each(['', '   ', 'blue', 'system', 'lightdark'])('rejects the invalid theme %j', (value) => {
    expect(() => Theme.create(value)).toThrow(ValidationError);
  });
});
