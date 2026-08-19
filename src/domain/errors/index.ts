export { ErrorCode } from './error-codes.js';
export { DomainError } from './domain-error.js';
export {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BusinessRuleError,
  RateLimitError,
  InternalError,
} from './errors.js';
export { serializeError, type SerializedError } from './serialize-error.js';
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  GENERIC_INTERNAL_MESSAGE,
  ERROR_MESSAGE_CATALOG,
  normalizeLocale,
  interpolate,
  resolveErrorMessage,
  type SupportedLocale,
} from './error-messages.js';
