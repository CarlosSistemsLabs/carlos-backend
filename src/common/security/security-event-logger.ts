import { getRequestId, getTenantId, getUserId } from '@common/context';

/**
 * Cohesive security-event audit logging (task 43.4, Requirements 17.7, 17.8).
 *
 * This is the SINGLE, consistent seam through which the platform records
 * security-relevant events as structured audit log lines so they are queryable
 * and correlate with the rest of the request logs. Every line carries the same
 * schema — a stable `event: 'security_event'` discriminator, a `category`, an
 * `action`, an `outcome`, the acting `actor`/`tenant`/`ip`/`request_id`, an ISO
 * `timestamp`, and non-sensitive `detail` — so a log-based pipeline can filter
 * on `event:'security_event'` (optionally `category`/`outcome`) to build a
 * security dashboard or trigger alerts (Requirement 17.7 — "log all
 * authentication attempts and authorization failures").
 *
 * ## Relationship to the existing auth logging (compose, don't duplicate)
 * Authentication attempts (login success/failure, lockout, refresh, logout) are
 * ALREADY emitted as structured lines by the auth module's
 * {@link StructuredAuthEventLogger} (the auth-specific facet of security
 * auditing) and fed to the {@link ISuspiciousActivityDetector} by the
 * {@link DetectingAuthEventLogger}. This logger is the COMPLEMENTARY facet for
 * the non-auth security paths that previously had no dedicated audit line:
 *  - **authorization failures** — emitted by the `app.authorize` guard on every
 *    denial, capturing the attempted `module`/`screen`/`action` and the actor
 *    (Requirement 17.7);
 *  - **suspicious activity** — e.g. rate-limit (429) hits, emitted from the
 *    central error handler's 429 path (Requirement 17.8), alongside the
 *    repeated-failed-login signal the detector already receives.
 *
 * It NEVER logs credentials, tokens, or other secrets — only non-sensitive
 * correlation and descriptive fields.
 */

/** Stable discriminator emitted in the `event` field of every security line. */
export const SECURITY_LOG_EVENT = 'security_event' as const;

/** High-level classification of a security event, used for log filtering. */
export type SecurityEventCategory = 'authentication' | 'authorization' | 'suspicious_activity';

/** Whether the audited operation ultimately succeeded or was denied/blocked. */
export type SecurityEventOutcome = 'success' | 'failure';

/**
 * Minimal structural subset of a pino logger the security logger depends on.
 *
 * Declared locally so the security module takes no hard dependency on pino;
 * Fastify's `app.log`/`request.log` and the application root logger satisfy it,
 * mirroring `AnalyticsLogger` / the auth module's `StructuredLogger`.
 */
export interface SecurityLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** Correlation fields enriched onto every event from the request context. */
export interface SecurityEventContextFields {
  tenant_id?: string;
  user_id?: string;
  request_id?: string;
}

/** Injectable clock so tests can assert on a deterministic timestamp. */
export type SecurityClock = () => Date;

const defaultClock: SecurityClock = () => new Date();

/**
 * The fully-enriched security event payload emitted to the log sink. This is the
 * canonical, queryable shape for every security-audit line.
 */
export interface SecurityEvent extends SecurityEventContextFields {
  /** Constant discriminator (`'security_event'`) for log-based filtering. */
  event: typeof SECURITY_LOG_EVENT;
  /** High-level category (authentication / authorization / suspicious_activity). */
  category: SecurityEventCategory;
  /** Specific action, e.g. `authorization_denied`, `rate_limit_exceeded`. */
  action: string;
  /** Whether the operation succeeded or was denied/blocked. */
  outcome: SecurityEventOutcome;
  /** Client IP address when known (never a credential). */
  ip_address?: string | null;
  /** ISO-8601 instant the event was recorded. */
  timestamp: string;
  /** Non-sensitive descriptive context (attempted action, counts, ...). */
  detail?: Record<string, unknown>;
}

/** Input describing an authorization denial audited by {@link ISecurityAuditLogger}. */
export interface AuthorizationDeniedInput {
  /** Attempted module (e.g. `products`). */
  module: string;
  /** Attempted screen (e.g. `list`). */
  screen: string;
  /** Attempted action (e.g. `read`). */
  action: string;
  /** Why access was denied (missing permission vs. role no longer exists). */
  reason: 'missing_permission' | 'role_not_found';
  /** Acting user id, when known (falls back to the request context). */
  userId?: string | undefined;
  /** Tenant id, when known (falls back to the request context). */
  tenantId?: string | undefined;
  /** Client IP address, when known. */
  ipAddress?: string | undefined;
  /** Request correlation id, when known (falls back to the request context). */
  requestId?: string | undefined;
}

/** Input describing a rate-limit hit audited by {@link ISecurityAuditLogger}. */
export interface RateLimitExceededInput {
  /** Client IP address of the throttled caller. */
  ipAddress: string;
  /** HTTP method of the throttled request. */
  method: string;
  /** Request path of the throttled request. */
  path: string;
  /** Acting user id, when authenticated (falls back to the request context). */
  userId?: string | undefined;
  /** Request correlation id, when known (falls back to the request context). */
  requestId?: string | undefined;
}

/**
 * Output port for recording security-audit events. Call sites (the authorization
 * guard, the error handler wiring) depend only on this abstraction; the concrete
 * sink (structured log today) is bound in the composition root.
 */
export interface ISecurityAuditLogger {
  /**
   * Records an authorization failure — an authenticated subject denied access to
   * a `module`/`screen`/`action` (Requirement 17.7). Logged at `warn`.
   */
  authorizationDenied(input: AuthorizationDeniedInput): void;

  /**
   * Records a rate-limit (429) hit as suspicious activity (Requirement 17.8).
   * Logged at `warn`.
   */
  rateLimitExceeded(input: RateLimitExceededInput): void;
}

/**
 * Reads the request-scoped correlation identifiers from the async context,
 * omitting any that are absent. Mirrors the analytics/logger context mixin so
 * security lines correlate with the request logs.
 */
function readContextFields(): SecurityEventContextFields {
  const fields: SecurityEventContextFields = {};

  const tenantId = getTenantId();
  if (tenantId !== undefined) {
    fields.tenant_id = tenantId;
  }
  const userId = getUserId();
  if (userId !== undefined) {
    fields.user_id = userId;
  }
  const requestId = getRequestId();
  if (requestId !== undefined) {
    fields.request_id = requestId;
  }

  return fields;
}

/**
 * Default {@link ISecurityAuditLogger}: emits each security event as a single
 * structured log line through the application logger.
 *
 * Failures (`outcome: 'failure'`) are logged at `warn` so they surface in
 * security dashboards/alerts; successes at `info`. Correlation fields
 * (`tenant_id`/`user_id`/`request_id`) are pulled from the async request context
 * automatically, and explicit values on the input take precedence when the
 * caller already knows them (e.g. the error handler reads `request.ip`). Never
 * logs credentials, tokens, or secrets.
 */
export class SecurityEventLogger implements ISecurityAuditLogger {
  constructor(
    private readonly logger: SecurityLogger,
    private readonly clock: SecurityClock = defaultClock,
  ) {}

  authorizationDenied(input: AuthorizationDeniedInput): void {
    const event = this.build('authorization', 'authorization_denied', 'failure', {
      contextOverride: {
        ...(input.tenantId !== undefined ? { tenant_id: input.tenantId } : {}),
        ...(input.userId !== undefined ? { user_id: input.userId } : {}),
        ...(input.requestId !== undefined ? { request_id: input.requestId } : {}),
      },
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      detail: {
        module: input.module,
        screen: input.screen,
        action: input.action,
        reason: input.reason,
      },
    });
    this.logger.warn(event as unknown as Record<string, unknown>, 'security event');
  }

  rateLimitExceeded(input: RateLimitExceededInput): void {
    const event = this.build('suspicious_activity', 'rate_limit_exceeded', 'failure', {
      contextOverride: {
        ...(input.userId !== undefined ? { user_id: input.userId } : {}),
        ...(input.requestId !== undefined ? { request_id: input.requestId } : {}),
      },
      ipAddress: input.ipAddress,
      detail: {
        method: input.method,
        path: input.path,
      },
    });
    this.logger.warn(event as unknown as Record<string, unknown>, 'security event');
  }

  /**
   * Builds the enriched {@link SecurityEvent}, merging request-context
   * correlation fields with any explicit overrides (explicit wins) and stamping
   * the time from the injected clock.
   */
  private build(
    category: SecurityEventCategory,
    action: string,
    outcome: SecurityEventOutcome,
    opts: {
      contextOverride?: SecurityEventContextFields;
      ipAddress?: string;
      detail?: Record<string, unknown>;
    },
  ): SecurityEvent {
    const event: SecurityEvent = {
      event: SECURITY_LOG_EVENT,
      category,
      action,
      outcome,
      timestamp: this.clock().toISOString(),
      ...readContextFields(),
      ...(opts.contextOverride ?? {}),
    };

    if (opts.ipAddress !== undefined) {
      event.ip_address = opts.ipAddress;
    }
    if (opts.detail !== undefined) {
      event.detail = opts.detail;
    }

    return event;
  }
}

/**
 * No-op {@link ISecurityAuditLogger} for call sites/tests that do not wire a
 * concrete sink. Preserves prior behaviour when a security logger is omitted.
 */
export class NoopSecurityAuditLogger implements ISecurityAuditLogger {
  authorizationDenied(_input: AuthorizationDeniedInput): void {
    // intentionally empty — security auditing disabled
  }

  rateLimitExceeded(_input: RateLimitExceededInput): void {
    // intentionally empty — security auditing disabled
  }
}
