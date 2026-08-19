import type { ISuspiciousActivityDetector } from '@common/alerting';
import type {
  AuthEventContext,
  AuthFailureReason,
  IAuthEventLogger,
} from '../application/ports/auth-event-logger.js';

/**
 * {@link IAuthEventLogger} decorator that also feeds the suspicious-activity
 * detector (task 31.4, Requirements 17.7, 17.8).
 *
 * Wraps an inner {@link IAuthEventLogger} (the {@link StructuredAuthEventLogger}
 * in production) so authentication events are still logged exactly as before,
 * and ADDITIONALLY forwards the security-relevant failure signals
 * (`loginFailed`, `accountLocked`) to an {@link ISuspiciousActivityDetector}.
 * This keeps the auth use cases untouched: they depend on the same
 * {@link IAuthEventLogger} port and are unaware a detector is now listening.
 *
 * Failures are keyed by the attempted **email** (the natural per-account
 * brute-force key), falling back to the client IP and then the user id so a
 * signal is always recorded even when the email is unknown.
 */
export class DetectingAuthEventLogger implements IAuthEventLogger {
  constructor(
    private readonly delegate: IAuthEventLogger,
    private readonly detector: ISuspiciousActivityDetector,
  ) {}

  loginSucceeded(ctx: AuthEventContext): void {
    this.delegate.loginSucceeded(ctx);
  }

  loginFailed(ctx: AuthEventContext, reason: AuthFailureReason): void {
    this.delegate.loginFailed(ctx, reason);
    this.detector.record({
      kind: 'failed_login',
      key: this.keyFor(ctx),
      context: this.signalContext(ctx, { reason }),
    });
  }

  accountLocked(ctx: AuthEventContext): void {
    this.delegate.accountLocked(ctx);
    this.detector.record({
      kind: 'account_locked',
      key: this.keyFor(ctx),
      context: this.signalContext(ctx),
    });
  }

  tokenRefreshed(ctx: AuthEventContext): void {
    this.delegate.tokenRefreshed(ctx);
  }

  logout(ctx: AuthEventContext): void {
    this.delegate.logout(ctx);
  }

  /** Resolves the brute-force grouping key: email → IP → user id → `unknown`. */
  private keyFor(ctx: AuthEventContext): string {
    return ctx.email ?? ctx.ipAddress ?? ctx.userId ?? 'unknown';
  }

  /** Builds non-sensitive alert context (never includes the password/credentials). */
  private signalContext(
    ctx: AuthEventContext,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      tenant_id: ctx.tenantId ?? null,
      ip_address: ctx.ipAddress ?? null,
      request_id: ctx.requestId ?? null,
      ...extra,
    };
  }
}
