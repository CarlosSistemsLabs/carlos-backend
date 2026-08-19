import type { Nullable, UUID } from '@shared/types/index.js';

/**
 * Reason an authentication attempt failed.
 *
 * These values are recorded in the structured logs so operators can tell *why*
 * a login was rejected. They are intentionally NOT surfaced to the client: the
 * thrown {@link InvalidCredentialsError} stays generic to avoid user
 * enumeration (Requirement 17.7 vs. anti-enumeration design).
 */
export type AuthFailureReason =
  | 'invalid_credentials'
  | 'account_locked'
  | 'account_inactive'
  | 'user_not_found';

/**
 * Contextual metadata captured for every authentication event.
 *
 * `userId` is only known once a user has been resolved; `ipAddress`/`userAgent`
 * are populated by the HTTP layer (task 8.4) and `requestId` by the per-request
 * context (`@common/context`). `timestamp` marks when the event occurred.
 */
export interface AuthEventContext {
  tenantId?: Nullable<UUID>;
  userId?: Nullable<UUID>;
  email?: Nullable<string>;
  ipAddress?: Nullable<string>;
  userAgent?: Nullable<string>;
  requestId?: Nullable<string>;
  timestamp: Date;
}

/**
 * Output port for recording authentication events (Requirement 17.7: "log all
 * authentication attempts and authorization failures").
 *
 * Defined in the application layer so the auth use cases can emit structured
 * audit events without depending on a concrete logger. The default
 * implementation writes structured application logs
 * ({@link StructuredAuthEventLogger}); persistent audit-trail storage to the
 * `AuditLog` table is a separate concern handled in task 43.4 and can be added
 * behind this same port.
 */
export interface IAuthEventLogger {
  /** Records a successful login. */
  loginSucceeded(ctx: AuthEventContext): void;

  /** Records a failed login attempt together with the reason it was rejected. */
  loginFailed(ctx: AuthEventContext, reason: AuthFailureReason): void;

  /** Records that an account was locked after too many failed attempts. */
  accountLocked(ctx: AuthEventContext): void;

  /** Records a successful access/refresh token rotation. */
  tokenRefreshed(ctx: AuthEventContext): void;

  /** Records a logout (refresh-token revocation). */
  logout(ctx: AuthEventContext): void;
}
