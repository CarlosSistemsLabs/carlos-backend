import type { FastifyInstance } from 'fastify';
import { deepSanitizeStrings, type DeepSanitizeOptions } from './deep-sanitize.js';

/**
 * Global request-input sanitization hook (task 43.1, Requirement 17.5).
 *
 * Registers a Fastify `preValidation` hook that deep-sanitizes `request.body`
 * so every string field is stripped of XSS vectors BEFORE the route's Zod
 * validation ({@link import('@presentation/validators/validate.js').validateBody})
 * runs and, transitively, before the value reaches any use case or repository.
 * Sanitizing at this single boundary — rather than sprinkling calls through
 * every route — guarantees uniform coverage with minimal churn and keeps the
 * domain/application layers unaware of the presentation concern.
 *
 * ## Why `preValidation` and why only the body
 * - `preValidation` runs after body parsing but before validation, so the
 *   sanitized value is what gets validated and handled; no handler ever sees the
 *   raw payload.
 * - Only the parsed request BODY is sanitized. Route params and the query string
 *   are typed/validated via Zod and used for lookups/filtering (never rendered
 *   as HTML by the server), and rewriting them risks corrupting identifiers or
 *   filter expressions. Output escaping (see
 *   {@link import('./sanitizer.js').escapeHtml}) covers any server-rendered
 *   surface.
 *
 * ## Preserving legitimate data
 * The underlying sanitizer is conservative: plain text, numbers and normal
 * punctuation pass through unchanged, and credential fields (passwords, tokens)
 * are skipped by default (see `DEFAULT_SKIP_FIELDS`). Rich-text fields can be
 * opted out per deployment by extending {@link DeepSanitizeOptions.skipFields}.
 * Only tag-like markup, script/style element bodies and dangerous URI schemes
 * are neutralized, so normal business payloads are byte-for-byte identical.
 *
 * The hook mutates `request.body` in place with the sanitized deep copy and is a
 * no-op when the body is absent or not an object/array (e.g. GET requests).
 */
export function registerInputSanitization(
  app: FastifyInstance,
  options: DeepSanitizeOptions = {},
): void {
  app.addHook('preValidation', (request, _reply, done) => {
    const { body } = request;
    if (body !== null && typeof body === 'object') {
      request.body = deepSanitizeStrings(body, options);
    }
    done();
  });
}
