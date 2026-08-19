import { getRequestId, getTenantId, getUserId } from '@common/context';

/**
 * Crash / error-reporting abstraction (task 33.3, Requirements 13.6, 21.8).
 *
 * ## Why this is a backend *seam*, not a Crashlytics integration
 * Firebase Crashlytics is fundamentally a CLIENT/mobile SDK: it captures native
 * crashes and non-fatal errors on the Android (task 51.3) and iOS (task 56.3)
 * devices and uploads them to the Crashlytics dashboard. There is **no
 * server-side Crashlytics SDK** — Requirement 21.8 ("Carlos_Platform SHALL use
 * Firebase Crashlytics for mobile crash reporting") is satisfied on the CLIENTS.
 *
 * What the BACKEND owns is the equivalent *server-side crash/error reporting
 * seam*: a stable {@link ICrashReporter} port with a
 * `reportError(error, context)` API that enriches every report with the request
 * correlation context (tenant, user, request id) + the caller-supplied
 * feature/module/role and the error's stack, and forwards it to an external
 * crash service. The default implementation emits a structured
 * `event: 'error_report'` log line that the ops pipeline (Railway log drain →
 * error tracker) consumes; a real server reporter (e.g. Sentry's Node SDK) binds
 * behind this SAME port later with zero call-site changes.
 *
 * ## Relationship to the error-tracking/alerting from task 31.4
 * The centralized error handler (task 31.4) already logs every 5xx/unknown error
 * at `error` with the full stack + request context (`buildErrorLogContext`) —
 * that line is the **local operator record**. The crash reporter is a *distinct*
 * concern: it is the canonical "report to an external crash service" seam. To
 * keep the two coherent and avoid double-emitting identical lines, the crash
 * report carries its own discriminator ({@link CRASH_REPORT_EVENT},
 * `report: true`) and purpose — a log-based rule keys off `event:'error_report'`
 * to forward to the crash tracker, while the plain 5xx `error` line remains the
 * local record. The error handler feeds the crash reporter on the 5xx/unknown
 * path only (never for 4xx client errors).
 */

/**
 * Caller-supplied, non-sensitive context attached to a crash report.
 *
 * The tenant/user/request identifiers are read automatically from the async
 * request context; these fields let the caller add the *domain* dimensions
 * Requirement 13.6 asks for (feature, user role) plus any extra breadcrumbs.
 */
export interface CrashContext {
  /** Feature / route the failure occurred in (e.g. `POST /api/v1/sales`). */
  feature?: string;
  /** Module / bounded-context the failure belongs to (e.g. `sales`). */
  module?: string;
  /**
   * User role, when known at the call site (Requirement 13.6 — "user role").
   * The backend async context does not currently carry the role, so it is
   * passed explicitly by callers that have it; the mobile clients enrich crash
   * reports with the role directly via the Crashlytics user-context API.
   */
  role?: string;
  /** Additional non-sensitive breadcrumbs. MUST NOT contain secrets or raw PII. */
  extra?: Readonly<Record<string, unknown>>;
}

/**
 * Output port for reporting an error/crash to an external crash service.
 *
 * Consumers (the error handler, background jobs) depend ONLY on this
 * abstraction so the backing transport (structured log today; Sentry/etc.
 * later) can be swapped in the composition root without touching them.
 */
export interface ICrashReporter {
  /**
   * Reports an error, enriched with the active `tenant_id`, `user_id` and
   * `request_id` (from the request context) plus the supplied
   * feature/module/role, the error's `name`/`message`/`stack`, and an ISO-8601
   * timestamp. Implementations MUST NOT throw — crash reporting must never break
   * the operation that failed (or the error handler that invoked it).
   */
  reportError(error: Error, context?: CrashContext): void;
}

/**
 * Discriminator emitted in the `event` field of every crash-report log line, so
 * a log-based rule can forward `event:'error_report'` lines to the external
 * crash tracker distinctly from the plain 5xx `error` line (task 31.4).
 */
export const CRASH_REPORT_EVENT = 'error_report' as const;

/**
 * Minimal structural subset of a pino logger the {@link StructuredLogCrashReporter}
 * needs. Fastify's `app.log`/`request.log` and the application root logger
 * satisfy it, mirroring the alerting/analytics modules' logger shapes.
 */
export interface CrashReporterLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Injectable clock, so tests can assert on a deterministic timestamp. */
export type CrashReporterClock = () => Date;

const defaultClock: CrashReporterClock = () => new Date();

/** Correlation fields enriched onto every report from the request context. */
interface CrashContextFields {
  tenant_id?: string;
  user_id?: string;
  request_id?: string;
}

/**
 * Reads the request-scoped correlation identifiers from the async context,
 * omitting any that are absent (outside a request scope, or before the auth
 * middleware resolved the tenant/user). Mirrors the logger's `contextMixin` so
 * crash reports correlate with request logs.
 */
function readContextFields(): CrashContextFields {
  const fields: CrashContextFields = {};

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
 * The fully-enriched crash-report payload handed to a sink. This is the
 * canonical shape emitted to the structured log and the shape a real crash
 * tracker (Sentry, etc.) would map from.
 */
export interface CrashReport extends CrashContextFields {
  /** Constant discriminator (`'error_report'`) for log-based forwarding. */
  event: typeof CRASH_REPORT_EVENT;
  /** Stable marker distinguishing a forwarded crash report from a local log. */
  report: true;
  /** The error class name (e.g. `Error`, `TypeError`). */
  error_name: string;
  /** The error message. */
  error_message: string;
  /** ISO-8601 instant the report was created. */
  timestamp: string;
  /** The captured stack trace, when present on the error. */
  stack?: string;
  /** Feature / route the failure occurred in, when supplied. */
  feature?: string;
  /** Module / bounded-context the failure belongs to, when supplied. */
  module?: string;
  /** User role, when supplied by the caller (Requirement 13.6). */
  role?: string;
  /** Additional non-sensitive breadcrumbs, when supplied. */
  extra?: Record<string, unknown>;
}

/**
 * Builds the enriched {@link CrashReport} for an error + context, pulling
 * correlation fields from the request context and stamping the time from the
 * supplied clock. Only assigns optional fields when present, satisfying
 * `exactOptionalPropertyTypes`.
 */
export function buildCrashReport(
  error: Error,
  context: CrashContext | undefined,
  clock: CrashReporterClock,
): CrashReport {
  const report: CrashReport = {
    event: CRASH_REPORT_EVENT,
    report: true,
    error_name: error.name,
    error_message: error.message,
    timestamp: clock().toISOString(),
    ...readContextFields(),
  };

  if (typeof error.stack === 'string') {
    report.stack = error.stack;
  }
  if (context?.feature !== undefined) {
    report.feature = context.feature;
  }
  if (context?.module !== undefined) {
    report.module = context.module;
  }
  if (context?.role !== undefined) {
    report.role = context.role;
  }
  if (context?.extra !== undefined) {
    report.extra = { ...context.extra };
  }

  return report;
}

/**
 * Default {@link ICrashReporter}: emits each report as a single structured log
 * line (`event: 'error_report'`, `report: true`, `error_name`, `error_message`,
 * `stack`, `tenant_id`, `user_id`, `request_id`, `feature`, `module`, `role`,
 * `timestamp`) through the application logger.
 *
 * This log stream IS the crash sink: a log-based pipeline forwards the
 * `event: 'error_report'` lines to an external crash tracker. A Sentry (or
 * similar) Node-SDK reporter can replace this implementation behind
 * {@link ICrashReporter} later without changing any caller. The `reportError`
 * call is wrapped so a throwing logger can never propagate an exception back to
 * the caller (Requirement: reporting must not break the failing operation).
 */
export class StructuredLogCrashReporter implements ICrashReporter {
  constructor(
    private readonly logger: CrashReporterLogger,
    private readonly clock: CrashReporterClock = defaultClock,
  ) {}

  public reportError(error: Error, context?: CrashContext): void {
    try {
      const report = buildCrashReport(error, context, this.clock);
      this.logger.error(
        report as unknown as Record<string, unknown>,
        `crash report: ${report.error_name}`,
      );
    } catch {
      // Swallow: crash reporting must never throw. If the logger itself fails
      // there is nothing more we can safely do here.
    }
  }
}

/**
 * No-op {@link ICrashReporter} for when crash reporting is disabled (e.g. a
 * deployment that opts out, or tests that assert callers invoke the port without
 * caring about the sink). {@link reportError} is intentionally a no-op.
 */
export class NoopCrashReporter implements ICrashReporter {
  public reportError(_error: Error, _context?: CrashContext): void {
    // intentionally empty — crash reporting disabled
  }
}
