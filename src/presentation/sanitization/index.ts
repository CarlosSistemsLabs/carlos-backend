/**
 * Input sanitization + output escaping module (task 43.1, Requirement 17.5).
 *
 * Public surface:
 * - {@link ISanitizer} / {@link HtmlSanitizer} / {@link defaultSanitizer} plus
 *   the {@link sanitizeHtml} / {@link escapeHtml} convenience functions.
 * - {@link deepSanitizeStrings} for recursive object sanitization.
 * - {@link registerInputSanitization} to wire the global request-body hook.
 */
export {
  type ISanitizer,
  HtmlSanitizer,
  defaultSanitizer,
  sanitizeHtml,
  escapeHtml,
} from './sanitizer.js';
export {
  deepSanitizeStrings,
  DEFAULT_SKIP_FIELDS,
  type DeepSanitizeOptions,
} from './deep-sanitize.js';
export { registerInputSanitization } from './sanitization-hook.js';
