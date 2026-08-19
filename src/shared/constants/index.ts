/**
 * Shared, framework-agnostic constants.
 *
 * Kept free of external dependencies so the domain layer may import them
 * (Clean Architecture, Requirement 3.2).
 */

/** Pagination bounds and defaults applied across list endpoints. */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MIN_PAGE_SIZE: 1,
  MAX_PAGE_SIZE: 100,
} as const;

/** Allowed sort directions. */
export const SORT_DIRECTION = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

/** Default tenant preferences, mirroring the Tenant data model defaults. */
export const TENANT_DEFAULTS = {
  LANGUAGE: 'es',
  CURRENCY: 'ARS',
  TIMEZONE: 'America/Argentina/Buenos_Aires',
  DATE_FORMAT: 'DD/MM/YYYY',
  THEME: 'light',
} as const;
