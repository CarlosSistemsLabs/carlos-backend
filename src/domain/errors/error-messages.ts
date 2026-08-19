import { ErrorCode } from './error-codes.js';

/**
 * Internationalization (i18n) catalog for user-facing error messages
 * (Requirement 27.1: "return user-friendly error messages in user's language").
 *
 * The catalog is a small, dependency-free, in-repo map so the domain layer stays
 * framework-free and no i18n runtime is required. Messages are keyed by
 * {@link ErrorCode}; every supported locale provides a translation for every
 * code. Spanish (`es`) is the platform's PRIMARY language and therefore the
 * {@link DEFAULT_LOCALE}; English (`en`) is provided as the universal fallback.
 *
 * The message resolution used by `serializeError` deliberately does NOT localize
 * when the caller passes no locale — it falls back to the error's own message so
 * the wire contract stays stable for callers that do not negotiate a language.
 */

/** BCP-47 primary sub-tags this catalog can translate into. */
export type SupportedLocale = 'es' | 'en';

/** The platform's primary language; used as the catalog fallback. */
export const DEFAULT_LOCALE: SupportedLocale = 'es';

/** The locales the catalog can translate into, in preference order. */
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['es', 'en'];

/**
 * Generic, English internal-error message.
 *
 * Kept as a stable constant because it is the sanitized message surfaced for
 * unexpected/unknown errors when no locale is negotiated — never leaking the
 * underlying failure (Requirement 21.5).
 */
export const GENERIC_INTERNAL_MESSAGE = 'An unexpected error occurred';

/** A single locale's translations, one entry per {@link ErrorCode}. */
type MessageCatalogEntry = Readonly<Record<ErrorCode, string>>;

/**
 * The translation catalog: `locale -> (ErrorCode -> localized message)`.
 *
 * Messages are intentionally user-friendly and free of internal detail so they
 * are safe to surface directly to API clients.
 */
export const ERROR_MESSAGE_CATALOG: Readonly<Record<SupportedLocale, MessageCatalogEntry>> = {
  es: {
    [ErrorCode.VALIDATION]: 'Los datos enviados no son válidos.',
    [ErrorCode.NOT_FOUND]: 'No se encontró el recurso solicitado.',
    [ErrorCode.CONFLICT]: 'La operación entra en conflicto con el estado actual.',
    [ErrorCode.UNAUTHORIZED]: 'Se requiere autenticación.',
    [ErrorCode.FORBIDDEN]: 'No tenés permiso para realizar esta acción.',
    [ErrorCode.BUSINESS_RULE]: 'La operación viola una regla de negocio.',
    [ErrorCode.RATE_LIMITED]: 'Demasiadas solicitudes. Intentá nuevamente más tarde.',
    [ErrorCode.INTERNAL]: 'Ocurrió un error inesperado.',
    [ErrorCode.AI_UNAVAILABLE]: 'El servicio de inteligencia artificial no está disponible.',
    [ErrorCode.AI_TIMEOUT]: 'La operación de inteligencia artificial superó el tiempo de espera.',
    [ErrorCode.SERVICE_UNAVAILABLE]:
      'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.',
  },
  en: {
    [ErrorCode.VALIDATION]: 'The submitted data is not valid.',
    [ErrorCode.NOT_FOUND]: 'The requested resource was not found.',
    [ErrorCode.CONFLICT]: 'The operation conflicts with the current state.',
    [ErrorCode.UNAUTHORIZED]: 'Authentication is required.',
    [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
    [ErrorCode.BUSINESS_RULE]: 'The operation violates a business rule.',
    [ErrorCode.RATE_LIMITED]: 'Too many requests. Please try again later.',
    [ErrorCode.INTERNAL]: GENERIC_INTERNAL_MESSAGE,
    [ErrorCode.AI_UNAVAILABLE]: 'The AI service is currently unavailable.',
    [ErrorCode.AI_TIMEOUT]: 'The AI operation timed out.',
    [ErrorCode.SERVICE_UNAVAILABLE]:
      'The service is temporarily unavailable. Please try again later.',
  },
};

/**
 * Normalizes an arbitrary locale hint (e.g. a BCP-47 tag like `'es-AR'`, or a
 * raw `Accept-Language` value) to a {@link SupportedLocale}, or `undefined` when
 * none of the requested languages are supported.
 *
 * Accepts either a single tag (`'es-AR'`) or a comma/semicolon list as found in
 * an `Accept-Language` header (`'es-AR,es;q=0.9,en;q=0.8'`); quality weights are
 * respected in declared order. Matching is case-insensitive and region-agnostic
 * (only the primary sub-tag is considered).
 */
export function normalizeLocale(locale: string | undefined): SupportedLocale | undefined {
  if (locale === undefined || locale.trim().length === 0) {
    return undefined;
  }

  // Parse an Accept-Language style list, honoring quality weights (q=...).
  const ranked = locale
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam === undefined ? 1 : Number.parseFloat(qParam.trim().slice(2));
      return { tag: (tag ?? '').trim().toLowerCase(), q: Number.isNaN(q) ? 0 : q };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    const match = SUPPORTED_LOCALES.find((supported) => supported === primary);
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

/**
 * Substitutes simple `{placeholder}` tokens in a template using values pulled
 * from `details` (e.g. `{entity}`, `{id}`). Missing keys are left untouched so
 * partial data never produces a misleading message. Kept intentionally minimal —
 * no format specifiers, no nested paths.
 */
export function interpolate(template: string, details?: Record<string, unknown>): string {
  if (details === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = details[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Resolves a localized, user-friendly message for an {@link ErrorCode}.
 *
 * Resolution order (Requirement 27.1):
 * 1. If a supported `locale` is requested, use the catalog entry for that locale
 *    (falling back to the {@link DEFAULT_LOCALE} entry for a missing translation).
 * 2. Otherwise fall back to the caller-supplied `ownMessage` (the error's own
 *    message) when present.
 * 3. Otherwise fall back to the {@link DEFAULT_LOCALE} catalog entry, and finally
 *    to {@link GENERIC_INTERNAL_MESSAGE}.
 *
 * Any `{placeholder}` tokens in the resolved message are interpolated from
 * `details`.
 */
export function resolveErrorMessage(
  code: ErrorCode,
  locale: string | undefined,
  ownMessage?: string,
  details?: Record<string, unknown>,
): string {
  const normalized = normalizeLocale(locale);
  if (normalized !== undefined) {
    const localized =
      ERROR_MESSAGE_CATALOG[normalized][code] ?? ERROR_MESSAGE_CATALOG[DEFAULT_LOCALE][code];
    if (localized !== undefined) {
      return interpolate(localized, details);
    }
  }

  if (ownMessage !== undefined && ownMessage.length > 0) {
    return interpolate(ownMessage, details);
  }

  const fallback = ERROR_MESSAGE_CATALOG[DEFAULT_LOCALE][code] ?? GENERIC_INTERNAL_MESSAGE;
  return interpolate(fallback, details);
}
