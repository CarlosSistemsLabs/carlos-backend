import { describe, it, expect } from 'vitest';
import { deepSanitizeStrings, DEFAULT_SKIP_FIELDS } from './deep-sanitize.js';
import type { ISanitizer } from './sanitizer.js';

describe('deepSanitizeStrings', () => {
  it('sanitizes nested string fields', () => {
    const input = {
      name: '<script>alert(1)</script>Acme',
      profile: {
        bio: '<img src=x onerror=alert(1)>Founder',
        website: 'javascript:alert(1)',
      },
      tags: ['<b>vip</b>', 'normal'],
    };

    const result = deepSanitizeStrings(input);

    expect(result.name).toBe('Acme');
    expect(result.profile.bio).toBe('Founder');
    expect(result.profile.website).not.toContain('javascript:');
    expect(result.tags).toEqual(['vip', 'normal']);
  });

  it('leaves non-string values untouched and preserves structure', () => {
    const created = new Date('2024-01-01T00:00:00.000Z');
    const input = {
      count: 42,
      active: true,
      ratio: 3.14,
      missing: null,
      createdAt: created,
      nested: { level: 2, flag: false },
    };

    const result = deepSanitizeStrings(input);

    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.ratio).toBe(3.14);
    expect(result.missing).toBeNull();
    expect(result.createdAt).toBe(created);
    expect(result.nested).toEqual({ level: 2, flag: false });
  });

  it('does not mutate the original input (pure function)', () => {
    const input = { name: '<script>x</script>keep' };
    const result = deepSanitizeStrings(input);

    expect(input.name).toBe('<script>x</script>keep');
    expect(result.name).toBe('keep');
    expect(result).not.toBe(input);
  });

  it('skips credential fields by default (opt-out via DEFAULT_SKIP_FIELDS)', () => {
    const input = {
      email: 'user@example.com',
      password: 'P<ass>word!<script>',
      refreshToken: 'tok<en>value',
    };

    const result = deepSanitizeStrings(input);

    // Credentials are opaque and must survive verbatim.
    expect(result.password).toBe('P<ass>word!<script>');
    expect(result.refreshToken).toBe('tok<en>value');
    expect(DEFAULT_SKIP_FIELDS).toContain('password');
  });

  it('respects a custom skip list by key name and dotted path', () => {
    const input = {
      article: { bodyHtml: '<b>rich</b> text', title: '<script>x</script>Title' },
      note: '<i>plain</i>',
    };

    const result = deepSanitizeStrings(input, {
      skipFields: ['article.bodyHtml'],
    });

    // Skipped by dotted path — rich text preserved.
    expect(result.article.bodyHtml).toBe('<b>rich</b> text');
    // Sibling and unrelated fields are still sanitized.
    expect(result.article.title).toBe('Title');
    expect(result.note).toBe('plain');
  });

  it('skips the entire subtree rooted at a skipped key', () => {
    const input = {
      raw: { a: '<script>x</script>', nested: { b: '<b>y</b>' } },
      clean: '<script>z</script>ok',
    };

    const result = deepSanitizeStrings(input, { skipFields: ['raw'] });

    expect(result.raw).toEqual({ a: '<script>x</script>', nested: { b: '<b>y</b>' } });
    expect(result.clean).toBe('ok');
  });

  it('uses an injected sanitizer', () => {
    const upper: ISanitizer = {
      sanitizeHtml: (value) => value.toUpperCase(),
      escapeHtml: (value) => value,
    };

    const result = deepSanitizeStrings({ name: 'abc', n: 1 }, { sanitizer: upper });

    expect(result.name).toBe('ABC');
    expect(result.n).toBe(1);
  });

  it('sanitizes string leaves inside arrays of objects', () => {
    const input = { items: [{ label: '<script>x</script>A' }, { label: 'B' }] };

    const result = deepSanitizeStrings(input);

    expect(result.items).toEqual([{ label: 'A' }, { label: 'B' }]);
  });
});
