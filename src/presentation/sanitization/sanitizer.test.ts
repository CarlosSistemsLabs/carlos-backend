import { describe, it, expect } from 'vitest';
import { HtmlSanitizer, defaultSanitizer, sanitizeHtml, escapeHtml } from './sanitizer.js';

describe('HtmlSanitizer.sanitizeHtml', () => {
  const sanitizer = new HtmlSanitizer();

  it('removes <script> elements together with their contents', () => {
    expect(sanitizer.sanitizeHtml('<script>alert(1)</script>')).toBe('');
    expect(sanitizer.sanitizeHtml('before<script>alert("x")</script>after')).toBe(
      'beforeafter',
    );
    // Case-insensitive and whitespace-tolerant opening tag.
    expect(sanitizer.sanitizeHtml('<SCRIPT >evil()</SCRIPT>')).toBe('');
  });

  it('removes style/iframe/object and other dangerous elements', () => {
    expect(sanitizer.sanitizeHtml('<style>body{}</style>text')).toBe('text');
    expect(sanitizer.sanitizeHtml('<iframe src="x"></iframe>ok')).toBe('ok');
    expect(sanitizer.sanitizeHtml('<object data="x"></object>ok')).toBe('ok');
  });

  it('strips event-handler attributes by removing the tag while keeping text', () => {
    expect(sanitizer.sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('');
    expect(sanitizer.sanitizeHtml('<div onclick="steal()">hello</div>')).toBe('hello');
    // The dangerous `onerror=` token must not survive anywhere.
    expect(sanitizer.sanitizeHtml('<img src=x onerror=alert(1)>caption')).not.toContain(
      'onerror',
    );
  });

  it('neutralizes javascript: and vbscript: URIs', () => {
    expect(sanitizer.sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('click');
    expect(sanitizer.sanitizeHtml('javascript:alert(1)')).not.toContain('javascript:');
    expect(sanitizer.sanitizeHtml('vbscript:msgbox(1)')).not.toContain('vbscript:');
    // Tolerant of the obfuscation browsers ignore.
    expect(sanitizer.sanitizeHtml('java\tscript:alert(1)')).not.toMatch(/script:/i);
  });

  it('removes HTML comments', () => {
    expect(sanitizer.sanitizeHtml('a<!-- <script>x</script> -->b')).toBe('ab');
  });

  it('preserves plain text, numbers and normal punctuation unchanged', () => {
    const samples = [
      'Sancho & Co.',
      'Café René — 100% natural',
      'stock < 10 unidades',
      'Price: $1,234.56 (final)',
      'email@example.com',
      "O'Brien & Sons, Inc.",
      'Order #42 — shipped!',
      '¿Cómo estás? ¡Bien!',
    ];
    for (const sample of samples) {
      expect(sanitizer.sanitizeHtml(sample)).toBe(sample);
    }
  });

  it('preserves an empty string', () => {
    expect(sanitizer.sanitizeHtml('')).toBe('');
  });

  it('is exposed as a shared default instance and free function', () => {
    expect(sanitizeHtml('<script>x</script>hi')).toBe('hi');
    expect(defaultSanitizer.sanitizeHtml('<b>bold</b>')).toBe('bold');
  });
});

describe('HtmlSanitizer.escapeHtml', () => {
  const sanitizer = new HtmlSanitizer();

  it('escapes the five HTML-significant characters', () => {
    expect(sanitizer.escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(sanitizer.escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });

  it('leaves text without significant characters unchanged', () => {
    expect(sanitizer.escapeHtml('plain text 123')).toBe('plain text 123');
  });

  it('escapes ampersands exactly once (no double-encoding within a single pass)', () => {
    expect(sanitizer.escapeHtml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('is exposed as a free function', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;');
  });
});
