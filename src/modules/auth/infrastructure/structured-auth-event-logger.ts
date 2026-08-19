import type {
  AuthEventContext,
  AuthFailureReason,
  IAuthEventLogger,
} from '../application/ports/auth-event-logger.js';

/**
 * Minimal structural subset of a pino logger.
 *
 * Declared locally so the auth module does not take a hard dependency on pino;
 * Fastify's `request.log` and the application's root logger both satisfy this
 * shape, mirroring the structured-logging approach in
 * `presentation/middlewares/request-logging.ts`.
 */
export interface StructuredLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** Discriminator value emitted in the `event` field of each log line. */
export type AuthEventName =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.account.locked'
  | 'auth.token.refreshed'
  | 'auth.logout';

/**
 * Structured-logging implementation of {@link IAuthEventLogger}.
 *
 * Emits one structured log line per authentication event using the same field
 * conventions as the request logger (`event`, `tenant_id`, `user_id`, `email`,
 * `request_id`, `reason`, ...). Successful events log at `info`; failures and
 * lockouts log at `warn` so they surface in security dashboards/alerts
 * (Requirement 17.7, 17.8).
 */
export class StructuredAuthEventLogger implements IAuthEventLogger {
  constructor(private readonly logger: StructuredLogger) {}

  loginSucceeded(ctx: AuthEventContext): void {
    this.logger.info(this.toFields('auth.login.succeeded', ctx), 'authentication attempt');
  }

  loginFailed(ctx: AuthEventContext, reason: AuthFailureReason): void {
    this.logger.warn(
      { ...this.toFields('auth.login.failed', ctx), reason },
      'authentication attempt',
    );
  }

  accountLocked(ctx: AuthEventContext): void {
    this.logger.warn(this.toFields('auth.account.locked', ctx), 'authentication attempt');
  }

  tokenRefreshed(ctx: AuthEventContext): void {
    this.logger.info(this.toFields('auth.token.refreshed', ctx), 'authentication attempt');
  }

  logout(ctx: AuthEventContext): void {
    this.logger.info(this.toFields('auth.logout', ctx), 'authentication attempt');
  }

  /** Projects an {@link AuthEventContext} onto the structured log fields. */
  private toFields(event: AuthEventName, ctx: AuthEventContext): Record<string, unknown> {
    return {
      event,
      tenant_id: ctx.tenantId ?? null,
      user_id: ctx.userId ?? null,
      email: ctx.email ?? null,
      ip_address: ctx.ipAddress ?? null,
      user_agent: ctx.userAgent ?? null,
      request_id: ctx.requestId ?? null,
      timestamp: ctx.timestamp.toISOString(),
    };
  }
}
