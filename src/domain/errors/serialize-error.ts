import { DomainError } from './domain-error.js';
import { ErrorCode } from './error-codes.js';
import { GENERIC_INTERNAL_MESSAGE, resolveErrorMessage } from './error-messages.js';

/**
 * The stable, sanitized shape produced when serializing any error for transport.
 *
 * This is the CORE error payload — a machine-readable {@link ErrorCode}, a
 * user-friendly (optionally localized) `message`, and optional safe `details`.
 * Outer layers (e.g. the HTTP error handler) wrap this with transport concerns
 * such as `timestamp`/`request_id` to form the final response envelope
 * (Requirement 25.4); the wire contract itself is owned by the presentation
 * layer, not here.
 */
export interface SerializedError {
  /** Stable, client-safe error code. */
  code: ErrorCode;
  /** User-facing message, localized when a supported `locale` is provided. */
  message: string;
  /** Optional structured, client-safe context. Absent when there is none. */
  details?: Record<string, unknown>;
}

/**
 * Serializes any thrown value into a stable, client-safe {@link SerializedError}.
 *
 * Behavior:
 * - {@link DomainError} (and every subclass — AI, plugin, etc.) serializes its
 *   own `code`, a localized user-friendly `message`, and its safe `details`.
 *   When a supported `locale` is provided the message comes from the i18n
 *   catalog keyed by the error's `code`; otherwise the error's own message is
 *   used (Requirement 27.1).
 * - Any other (unknown / unexpected) value serializes as a generic
 *   {@link ErrorCode.INTERNAL} error and NEVER leaks the underlying message,
 *   stack, or type (Requirement 21.5). The generic message is localized when a
 *   supported `locale` is provided.
 *
 * This function is transport-agnostic and safe to reuse anywhere an error must
 * be turned into a payload (HTTP handler, background jobs, WebSocket frames).
 *
 * @param error - The thrown value to serialize.
 * @param locale - Optional locale hint (BCP-47 tag or `Accept-Language` value).
 */
export function serializeError(error: unknown, locale?: string): SerializedError {
  if (error instanceof DomainError) {
    const message = resolveErrorMessage(error.code, locale, error.message, error.details);
    const serialized: SerializedError = { code: error.code, message };
    if (error.details !== undefined) {
      serialized.details = error.details;
    }
    return serialized;
  }

  // Unknown/unexpected error: return a sanitized generic INTERNAL error. The
  // caller's own message is intentionally NOT forwarded, so internals never
  // leak; only the safe generic message is exposed.
  return {
    code: ErrorCode.INTERNAL,
    message: resolveErrorMessage(ErrorCode.INTERNAL, locale, GENERIC_INTERNAL_MESSAGE),
  };
}
