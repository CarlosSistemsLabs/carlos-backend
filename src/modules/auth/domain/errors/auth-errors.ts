import { UnauthorizedError } from '@domain/errors/index.js';

/**
 * Raised when authentication fails because the supplied credentials do not
 * match any active account.
 *
 * The message is intentionally generic ("Invalid email or password") so the
 * API does not reveal whether an email exists, mitigating user enumeration.
 */
export class InvalidCredentialsError extends UnauthorizedError {
  constructor(details?: Record<string, unknown>) {
    super('Invalid email or password', details);
  }
}

/**
 * Raised when authentication is rejected because the account is temporarily
 * locked after too many failed login attempts (Requirement 8.8).
 */
export class AccountLockedError extends UnauthorizedError {
  constructor(lockedUntil?: Date) {
    super(
      'Account is temporarily locked due to too many failed login attempts',
      lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : undefined,
    );
  }
}

/**
 * Raised when authentication is rejected because the account has been
 * deactivated.
 */
export class AccountInactiveError extends UnauthorizedError {
  constructor() {
    super('Account is inactive');
  }
}

/**
 * Raised when a refresh token is missing, unknown, expired or already revoked.
 */
export class InvalidRefreshTokenError extends UnauthorizedError {
  constructor(message = 'Refresh token is invalid or expired') {
    super(message);
  }
}
