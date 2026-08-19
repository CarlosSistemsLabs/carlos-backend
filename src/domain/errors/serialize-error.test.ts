import { describe, it, expect } from 'vitest';
import { ErrorCode } from './error-codes.js';
import { serializeError } from './serialize-error.js';
import {
  DEFAULT_LOCALE,
  GENERIC_INTERNAL_MESSAGE,
  ERROR_MESSAGE_CATALOG,
  interpolate,
  normalizeLocale,
  resolveErrorMessage,
} from './error-messages.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BusinessRuleError,
  RateLimitError,
  InternalError,
} from './errors.js';

describe('serializeError', () => {
  const domainCases = [
    { build: () => new ValidationError('bad input', { field: 'email' }), code: ErrorCode.VALIDATION },
    { build: () => new NotFoundError('missing'), code: ErrorCode.NOT_FOUND },
    { build: () => new ConflictError('dup'), code: ErrorCode.CONFLICT },
    { build: () => new UnauthorizedError(), code: ErrorCode.UNAUTHORIZED },
    { build: () => new ForbiddenError(), code: ErrorCode.FORBIDDEN },
    { build: () => new BusinessRuleError('nope'), code: ErrorCode.BUSINESS_RULE },
    { build: () => new RateLimitError(), code: ErrorCode.RATE_LIMITED },
    { build: () => new InternalError('boom'), code: ErrorCode.INTERNAL },
  ] as const;

  for (const { build, code } of domainCases) {
    it(`maps ${code} to its code with a string message`, () => {
      const serialized = serializeError(build());
      expect(serialized.code).toBe(code);
      expect(typeof serialized.message).toBe('string');
      expect(serialized.message.length).toBeGreaterThan(0);
    });
  }

  it('includes safe details from a domain error', () => {
    const serialized = serializeError(new ValidationError('bad', { field: 'email' }));
    expect(serialized.details).toEqual({ field: 'email' });
  });

  it('omits details when the domain error has none', () => {
    const serialized = serializeError(new UnauthorizedError());
    expect(serialized.details).toBeUndefined();
  });

  it('without a locale, uses the domain error own message', () => {
    const serialized = serializeError(new NotFoundError('custom not found message'));
    expect(serialized.message).toBe('custom not found message');
  });

  it('maps an unknown Error to a generic INTERNAL error without leaking internals', () => {
    const serialized = serializeError(new Error('super secret internal explosion'));
    expect(serialized.code).toBe(ErrorCode.INTERNAL);
    expect(serialized.message).toBe(GENERIC_INTERNAL_MESSAGE);
    expect(serialized.details).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('super secret internal explosion');
  });

  it('maps a non-Error thrown value to a generic INTERNAL error', () => {
    const serialized = serializeError('a raw string was thrown');
    expect(serialized.code).toBe(ErrorCode.INTERNAL);
    expect(serialized.message).toBe(GENERIC_INTERNAL_MESSAGE);
    expect(JSON.stringify(serialized)).not.toContain('a raw string was thrown');
  });

  it('serializes an InternalError (a known DomainError) with its own message when no locale is given', () => {
    const serialized = serializeError(new InternalError('boom', { cause: 'db' }));
    expect(serialized.code).toBe(ErrorCode.INTERNAL);
    expect(serialized.message).toBe('boom');
    expect(serialized.details).toEqual({ cause: 'db' });
  });

  it('localizes an InternalError message when a supported locale is given', () => {
    expect(serializeError(new InternalError('boom'), 'es').message).toBe(
      ERROR_MESSAGE_CATALOG.es[ErrorCode.INTERNAL],
    );
    expect(serializeError(new InternalError('boom'), 'en').message).toBe(
      ERROR_MESSAGE_CATALOG.en[ErrorCode.INTERNAL],
    );
  });
});

describe('serializeError internationalization (Requirement 27.1)', () => {
  it('localizes a domain error message in Spanish for es', () => {
    const serialized = serializeError(new NotFoundError('missing'), 'es');
    expect(serialized.code).toBe(ErrorCode.NOT_FOUND);
    expect(serialized.message).toBe(ERROR_MESSAGE_CATALOG.es[ErrorCode.NOT_FOUND]);
  });

  it('localizes a domain error message in English for en', () => {
    const serialized = serializeError(new NotFoundError('missing'), 'en');
    expect(serialized.message).toBe(ERROR_MESSAGE_CATALOG.en[ErrorCode.NOT_FOUND]);
  });

  it('produces different messages for es and en', () => {
    const es = serializeError(new ForbiddenError(), 'es');
    const en = serializeError(new ForbiddenError(), 'en');
    expect(es.message).not.toBe(en.message);
  });

  it('honors a full Accept-Language header value with region and quality weights', () => {
    const serialized = serializeError(new ConflictError(), 'es-AR,es;q=0.9,en;q=0.8');
    expect(serialized.message).toBe(ERROR_MESSAGE_CATALOG.es[ErrorCode.CONFLICT]);
  });

  it('localizes the generic INTERNAL message for unknown errors per locale', () => {
    expect(serializeError(new Error('boom'), 'es').message).toBe(
      ERROR_MESSAGE_CATALOG.es[ErrorCode.INTERNAL],
    );
    expect(serializeError(new Error('boom'), 'en').message).toBe(
      ERROR_MESSAGE_CATALOG.en[ErrorCode.INTERNAL],
    );
  });

  it('falls back to the domain error own message for an unsupported locale', () => {
    const serialized = serializeError(new NotFoundError('own fallback message'), 'fr');
    expect(serialized.message).toBe('own fallback message');
  });

  it('falls back to the generic message for an unsupported locale on unknown errors', () => {
    const serialized = serializeError(new Error('boom'), 'fr');
    expect(serialized.message).toBe(GENERIC_INTERNAL_MESSAGE);
  });
});

describe('normalizeLocale', () => {
  it('returns undefined for missing/empty input', () => {
    expect(normalizeLocale(undefined)).toBeUndefined();
    expect(normalizeLocale('')).toBeUndefined();
    expect(normalizeLocale('   ')).toBeUndefined();
  });

  it('strips region and lowercases the primary sub-tag', () => {
    expect(normalizeLocale('es-AR')).toBe('es');
    expect(normalizeLocale('EN-US')).toBe('en');
  });

  it('returns undefined for an unsupported language', () => {
    expect(normalizeLocale('fr')).toBeUndefined();
    expect(normalizeLocale('de-DE')).toBeUndefined();
  });

  it('picks the highest-quality supported language from a list', () => {
    expect(normalizeLocale('fr;q=1.0,en;q=0.8,es;q=0.9')).toBe('es');
    expect(normalizeLocale('de,en;q=0.5')).toBe('en');
  });
});

describe('resolveErrorMessage', () => {
  it('prefers the catalog for a supported locale over the own message', () => {
    const message = resolveErrorMessage(ErrorCode.VALIDATION, 'es', 'own message');
    expect(message).toBe(ERROR_MESSAGE_CATALOG.es[ErrorCode.VALIDATION]);
  });

  it('uses the DEFAULT_LOCALE catalog constant as the primary language (es)', () => {
    expect(DEFAULT_LOCALE).toBe('es');
  });

  it('falls back to the own message when no locale is provided', () => {
    expect(resolveErrorMessage(ErrorCode.VALIDATION, undefined, 'own message')).toBe('own message');
  });
});

describe('interpolate', () => {
  it('substitutes present placeholders from details', () => {
    expect(interpolate('No se encontró {entity} con id "{id}".', { entity: 'Producto', id: 'abc' })).toBe(
      'No se encontró Producto con id "abc".',
    );
  });

  it('leaves placeholders untouched when the key is missing', () => {
    expect(interpolate('missing {key}', { other: 1 })).toBe('missing {key}');
  });

  it('returns the template unchanged when there are no details', () => {
    expect(interpolate('no placeholders here')).toBe('no placeholders here');
  });
});
