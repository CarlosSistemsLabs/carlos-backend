import { defaultSanitizer, type ISanitizer } from './sanitizer.js';

/**
 * Recursive object sanitization for request payloads (task 43.1,
 * Requirement 17.5).
 *
 * Walks an arbitrary JSON-shaped value and runs every STRING leaf through an
 * {@link ISanitizer} while leaving every non-string value (numbers, booleans,
 * `null`, dates, buffers) untouched and preserving the overall structure. This
 * is what the request-input hook applies to `request.body` so a malicious
 * payload is neutralized before any use case or repository sees it.
 *
 * ## Opt-out / allowlist
 * Some fields legitimately hold rich text (markdown/HTML a downstream renderer
 * escapes itself) or opaque credential material (passwords, tokens) that must
 * be preserved byte-for-byte. Those are skipped via {@link DeepSanitizeOptions.skipFields}:
 * a field is skipped when its KEY NAME matches an entry (e.g. `password`) OR its
 * full dotted PATH matches (e.g. `article.bodyHtml`). Skipping applies to the
 * entire subtree rooted at that key, so a skipped object/array is left intact.
 *
 * The function is PURE: it returns a sanitized deep copy and never mutates the
 * input, so callers can compare or keep the original if needed.
 */

/** Options controlling {@link deepSanitizeStrings}. */
export interface DeepSanitizeOptions {
  /**
   * Sanitizer applied to each string leaf. Defaults to the shared
   * {@link defaultSanitizer}; inject a different {@link ISanitizer} (e.g. a
   * DOMPurify adapter) to change the policy without touching call sites.
   */
  sanitizer?: ISanitizer;
  /**
   * Field key names or dotted paths whose subtree is left untouched. Matching is
   * case-sensitive and accepts either the bare key (matches at any depth) or the
   * full dotted path from the root. Use for rich-text or credential fields.
   */
  skipFields?: readonly string[];
}

/**
 * Default skip list. Credential/secret fields are opaque, never rendered as
 * HTML, and are hashed or compared verbatim downstream, so sanitizing them would
 * be semantically wrong (it could silently alter a valid secret). Callers may
 * extend or replace this via {@link DeepSanitizeOptions.skipFields}.
 */
export const DEFAULT_SKIP_FIELDS: readonly string[] = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordConfirmation',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
];

/**
 * Returns a sanitized deep copy of `value`.
 *
 * - Strings are passed through {@link ISanitizer.sanitizeHtml}.
 * - Arrays are recursed element-wise (indices do not participate in field
 *   skipping — the array's own key controls whether the whole array is skipped).
 * - Plain objects are recursed key-wise; a key in the skip set (by name or
 *   dotted path) has its value copied through unchanged.
 * - All other values (number, boolean, null, undefined, Date, Buffer, class
 *   instances) are returned as-is.
 */
export function deepSanitizeStrings<T>(value: T, options: DeepSanitizeOptions = {}): T {
  const sanitizer = options.sanitizer ?? defaultSanitizer;
  const skipFields = options.skipFields ?? DEFAULT_SKIP_FIELDS;
  const skip = new Set(skipFields);
  return sanitizeNode(value, sanitizer, skip, '') as T;
}

/**
 * Recursive worker. `path` is the dotted path to `node` from the root ('' at the
 * root); `key` skipping is evaluated by the caller before descending.
 */
function sanitizeNode(
  node: unknown,
  sanitizer: ISanitizer,
  skip: ReadonlySet<string>,
  path: string,
): unknown {
  if (typeof node === 'string') {
    return sanitizer.sanitizeHtml(node);
  }

  if (Array.isArray(node)) {
    return node.map((item) => sanitizeNode(item, sanitizer, skip, path));
  }

  // Only recurse into plain objects. Class instances, Dates, Buffers, etc. are
  // left intact so their internal invariants are never disturbed.
  if (isPlainObject(node)) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (skip.has(key) || skip.has(childPath)) {
        result[key] = child;
      } else {
        result[key] = sanitizeNode(child, sanitizer, skip, childPath);
      }
    }
    return result;
  }

  // number | boolean | null | undefined | bigint | symbol | function | non-plain object
  return node;
}

/**
 * Narrow test for a plain (data) object — one created via object literal or
 * `Object.create(null)` — so class instances and exotic objects are treated as
 * opaque leaves.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
