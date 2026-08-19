/**
 * Input sanitization + output escaping utilities (task 43.1, Requirement 17.5).
 *
 * ## What this is
 * The single seam through which the backend neutralizes cross-site-scripting
 * (XSS) vectors carried in user-supplied strings. It exposes two orthogonal
 * operations behind the {@link ISanitizer} interface:
 *
 * - {@link ISanitizer.sanitizeHtml} — **input sanitization**. Strips dangerous
 *   markup (script/style/iframe elements, all other HTML tags and their
 *   attributes such as `onerror=`, HTML comments) and neutralizes dangerous URI
 *   schemes (`javascript:`, `vbscript:`) while PRESERVING the surrounding plain
 *   text, numbers and normal punctuation. This is applied to inbound request
 *   bodies BEFORE they reach use cases / persistence (see
 *   {@link import('./sanitization-hook.js').registerInputSanitization}) so a
 *   stored value can never carry an executable payload.
 * - {@link ISanitizer.escapeHtml} — **output escaping**. Encodes the five
 *   HTML-significant characters (`& < > " '`) so a string can be safely emitted
 *   INSIDE server-rendered HTML (e.g. Swagger branding, an email template). The
 *   platform API is JSON — clients escape on render and the correct
 *   `Content-Type: application/json` already prevents the browser from
 *   interpreting a response as HTML — so JSON responses are intentionally NOT
 *   escaped (that would corrupt legitimate data like `"Sancho & Co."`). Use this
 *   helper only where the server itself produces HTML.
 *
 * ## Sanitization policy (why it is conservative)
 * Business data legitimately contains `&`, `<`, `>` in prose ("stock < 10",
 * "R&D"), accented characters and punctuation. Escaping every field on the way
 * IN would corrupt that data and double-encode on every round-trip. Therefore
 * the input path SANITIZES (removes markup / dangerous schemes) rather than
 * ESCAPES: normal alphanumeric/business text passes through byte-for-byte
 * unchanged, and only tag-like markup (`<tag ...>`), script/style element bodies
 * and dangerous URI schemes are neutralized. Escaping is reserved for the OUTPUT
 * path where the server emits HTML.
 *
 * ## Deferred dependency (DOMPurify)
 * A DOMPurify-backed implementation (`isomorphic-dompurify`, or `dompurify` +
 * `jsdom`) is the industry-standard allowlist sanitizer and was the preferred
 * choice. This environment sits behind an SSL-inspecting proxy that blocks its
 * installation from the npm registry (the same constraint documented for the
 * `redis` client — see {@link import('@infrastructure/cache/redis-cache.js').RedisCache}).
 * Rather than weaken TLS verification, the default {@link HtmlSanitizer} is a
 * self-contained, dependency-free implementation of the SAME {@link ISanitizer}
 * contract. A DOMPurify adapter can bind behind this identical seam later (see
 * `./README.md`) with NO change to callers or the request hook — mirroring the
 * deferred-dependency pattern used for `firebase-admin` / `redis`.
 */

/**
 * The sanitization + escaping contract. Modelling it as an interface keeps the
 * request hook and shared validators decoupled from the concrete
 * implementation, so a DOMPurify-backed adapter can replace {@link HtmlSanitizer}
 * without touching consumers.
 */
export interface ISanitizer {
  /**
   * Neutralizes XSS vectors in `input` while preserving its plain-text content.
   * Removes script/style/iframe (and similar) elements together with their
   * contents, strips all other HTML tags (keeping the inner text) and their
   * attributes, removes HTML comments, and defangs dangerous URI schemes
   * (`javascript:` / `vbscript:`). Plain text, numbers and normal punctuation
   * are returned unchanged.
   */
  sanitizeHtml(input: string): string;

  /**
   * Escapes the five HTML-significant characters (`&`, `<`, `>`, `"`, `'`) so
   * `input` can be safely interpolated into server-rendered HTML. Intended for
   * OUTPUT contexts only; JSON responses must not be escaped.
   */
  escapeHtml(input: string): string;
}

/** Maps each HTML-significant character to its numeric/entity reference. */
const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Matches any HTML-significant character for a single-pass escape. */
const HTML_ESCAPE_PATTERN = /[&<>"']/g;

/**
 * Dangerous elements whose ENTIRE contents (not just the tags) must be removed,
 * because the text between the tags is executable/interpretable rather than
 * displayable content.
 */
const DANGEROUS_ELEMENTS = 'script|style|iframe|object|embed|noscript|template|link|meta|base';

/** Removes `<script>…</script>`-style elements including their inner payload. */
const DANGEROUS_ELEMENT_PATTERN = new RegExp(
  `<\\s*(${DANGEROUS_ELEMENTS})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>`,
  'gi',
);

/** Removes a stray/unclosed dangerous opening or self-closing tag. */
const DANGEROUS_OPEN_TAG_PATTERN = new RegExp(
  `<\\s*/?\\s*(${DANGEROUS_ELEMENTS})\\b[^>]*>`,
  'gi',
);

/** Matches HTML comments (which can hide conditional-comment script payloads). */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/**
 * Matches any remaining HTML tag: `<` optionally followed by `/`, then a letter
 * (so mathematical `<` such as "a < b" or "x<3" is preserved), up to the next
 * `>`. Only well-formed `<tag …>` markup is stripped; the inner text is kept.
 */
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

/**
 * Matches dangerous URI schemes (`javascript:` / `vbscript:`) tolerant of
 * embedded whitespace/control characters browsers ignore (e.g. `java\tscript:`).
 * The scheme keyword is removed so a lingering payload cannot be resurrected as
 * an executable URI.
 */
const DANGEROUS_SCHEME_PATTERN =
  /(?:j\s*a\s*v\s*a|v\s*b)\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi;

/**
 * Default, dependency-free {@link ISanitizer}. Implements the conservative
 * input-sanitization + output-escaping policy documented at the top of this
 * module using well-tested regular expressions rather than a full HTML parser.
 * A DOMPurify-backed adapter can replace this behind the {@link ISanitizer}
 * seam when the dependency can be installed.
 */
export class HtmlSanitizer implements ISanitizer {
  /** @inheritdoc */
  sanitizeHtml(input: string): string {
    // Fast path: only strings can carry markup. Non-string callers are guarded
    // upstream, but this keeps the method total and side-effect free.
    if (input.length === 0) {
      return input;
    }

    let output = input;
    // 1. Drop HTML comments first so a comment cannot mask a dangerous element.
    output = output.replace(HTML_COMMENT_PATTERN, '');
    // 2. Remove dangerous elements together with their executable contents.
    output = output.replace(DANGEROUS_ELEMENT_PATTERN, '');
    // 3. Remove any stray/unclosed dangerous opening tags left behind.
    output = output.replace(DANGEROUS_OPEN_TAG_PATTERN, '');
    // 4. Strip all remaining HTML tags (and their attributes, incl. `onerror=`),
    //    keeping the inner text so displayable content survives.
    output = output.replace(HTML_TAG_PATTERN, '');
    // 5. Defang dangerous URI schemes that may survive as bare text.
    output = output.replace(DANGEROUS_SCHEME_PATTERN, '');
    return output;
  }

  /** @inheritdoc */
  escapeHtml(input: string): string {
    return input.replace(HTML_ESCAPE_PATTERN, (char) => HTML_ESCAPE_MAP[char] ?? char);
  }
}

/**
 * Process-wide default sanitizer. A single stateless instance is safe to share;
 * consumers that need a different policy (e.g. a DOMPurify adapter) inject their
 * own {@link ISanitizer}.
 */
export const defaultSanitizer: ISanitizer = new HtmlSanitizer();

/**
 * Convenience free function delegating to {@link defaultSanitizer}. Neutralizes
 * XSS vectors in `input` while preserving plain text (Requirement 17.5).
 */
export function sanitizeHtml(input: string): string {
  return defaultSanitizer.sanitizeHtml(input);
}

/**
 * Convenience free function delegating to {@link defaultSanitizer}. Escapes
 * HTML-significant characters for safe emission into server-rendered HTML
 * (Requirement 17.5).
 */
export function escapeHtml(input: string): string {
  return defaultSanitizer.escapeHtml(input);
}
