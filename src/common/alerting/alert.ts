/**
 * Alerting abstraction (task 31.4, Requirements 17.8, 21.5, 21.7).
 *
 * Defines the {@link IAlertNotifier} output port through which the platform
 * raises operational/security alerts, plus a dependency-free, log-based default
 * implementation ({@link LogAlertNotifier}).
 *
 * ## Why a log-based default (and not a pager/Slack SDK)
 * Wiring a real pager (PagerDuty), chat (Slack), or email transport is an
 * **operations/infrastructure** concern, not an application concern: it needs
 * secrets, retry/back-pressure policy, and an on-call routing configuration that
 * live outside this service. The application's responsibility is to *emit a
 * clearly-identifiable, structured alert signal*; the platform's log pipeline
 * (Railway log drain → a log-based alerting rule) turns that signal into a page.
 *
 * The default {@link LogAlertNotifier} therefore emits a single structured log
 * line carrying `alert: true` at `error` (warning/info) or `fatal` (critical)
 * level. A log-based alerting rule keys off `alert:true` + `severity` to notify
 * administrators within the required window (Requirement 17.8 — within 5 min).
 *
 * A real Slack/PagerDuty/email notifier binds behind this SAME port later
 * (composition root) with zero changes to the monitors that depend on it.
 */

/** Alert severity, ordered from least to most urgent. */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** A single alert raised through the {@link IAlertNotifier} port. */
export interface Alert {
  /** Urgency; `critical` alerts are emitted at `fatal` level by the log notifier. */
  readonly severity: AlertSeverity;
  /** Short, human-readable headline (used as the log message). */
  readonly title: string;
  /** Longer description of what happened and why it matters. */
  readonly description: string;
  /**
   * Structured, non-sensitive context (counts, window, keys). MUST NOT contain
   * secrets or raw PII — it is logged verbatim.
   */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Output port for raising alerts. Monitors/detectors depend ONLY on this
 * interface so the backing transport (log-based today; Slack/PagerDuty/email
 * later) can be swapped in the composition root without touching them.
 */
export interface IAlertNotifier {
  /** Raises a single alert. Implementations MUST NOT throw. */
  sendAlert(alert: Alert): void;
}

/**
 * Minimal structural subset of a pino logger the {@link LogAlertNotifier} needs.
 * Fastify's `app.log`/`request.log` and the application root logger satisfy it,
 * mirroring the `StructuredLogger` shape used elsewhere.
 */
export interface AlertLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
  fatal(obj: Record<string, unknown>, msg?: string): void;
}

/** Discriminator emitted in the `event` field of every alert log line. */
export const ALERT_EVENT = 'alert' as const;

/**
 * Log-based default {@link IAlertNotifier}.
 *
 * Emits one structured line per alert with a stable `alert: true` marker and an
 * `event: 'alert'` discriminator so an external log-based alerting rule can
 * trigger on it. `critical` alerts log at `fatal`; everything else at `error`
 * (both levels are always enabled in production where `LOG_LEVEL=info`).
 */
export class LogAlertNotifier implements IAlertNotifier {
  constructor(
    private readonly logger: AlertLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public sendAlert(alert: Alert): void {
    const fields: Record<string, unknown> = {
      alert: true,
      event: ALERT_EVENT,
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      context: alert.context ?? {},
      timestamp: this.now().toISOString(),
    };

    if (alert.severity === 'critical') {
      this.logger.fatal(fields, alert.title);
    } else {
      this.logger.error(fields, alert.title);
    }
  }
}
