import type { Alert, IAlertNotifier } from './alert.js';

/**
 * Critical-error-threshold monitor (task 31.4, Requirements 21.7, 21.5).
 *
 * An event-driven, rolling-window counter of server (`5xx`) errors. The error
 * handler feeds one observation per server error via {@link recordServerError};
 * when the number of errors observed **within the rolling window** reaches the
 * configured threshold the monitor raises a `critical` alert through the
 * {@link IAlertNotifier} port.
 *
 * ## Why event-driven (not sampling the metrics registry)
 * Feeding the monitor directly from the error handler makes it deterministic and
 * unit-testable (no timers, no polling races) and gives sub-second detection —
 * the alert fires on the error that crosses the threshold. The metrics registry
 * remains the read-model for scraping; this monitor is the write-path trigger.
 *
 * ## Cooldown (anti-alert-storm)
 * After firing, the monitor stays silent for `cooldownMs` even if the rate stays
 * high, so a sustained incident produces one alert (plus periodic re-alerts once
 * the cooldown lapses) instead of an alert per error.
 */
export interface ErrorRateMonitorOptions {
  /** Number of server errors within the window that trips the alert (> 0). */
  readonly threshold: number;
  /** Rolling-window length in milliseconds (> 0). */
  readonly windowMs: number;
  /** Minimum gap between two alerts in milliseconds (>= 0). */
  readonly cooldownMs: number;
  /** Injectable clock (milliseconds); defaults to {@link Date.now}. */
  readonly now?: () => number;
}

/** Non-sensitive context attached to a fired error-rate alert. */
export interface ServerErrorObservation {
  /** Final response status code (>= 500). */
  readonly statusCode?: number;
  /** Route pattern / path the error occurred on. */
  readonly path?: string;
  /** Correlation id of the triggering request. */
  readonly requestId?: string;
}

export class ErrorRateMonitor {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  /** Timestamps (ms) of retained server errors within the current window. */
  private readonly hits: number[] = [];
  /** Timestamp of the last alert, or `undefined` when none fired yet. */
  private lastAlertAt: number | undefined;

  constructor(
    private readonly notifier: IAlertNotifier,
    options: ErrorRateMonitorOptions,
  ) {
    if (options.threshold <= 0) {
      throw new Error('ErrorRateMonitor threshold must be a positive integer');
    }
    if (options.windowMs <= 0) {
      throw new Error('ErrorRateMonitor windowMs must be a positive integer');
    }
    if (options.cooldownMs < 0) {
      throw new Error('ErrorRateMonitor cooldownMs must be non-negative');
    }
    this.threshold = options.threshold;
    this.windowMs = options.windowMs;
    this.cooldownMs = options.cooldownMs;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Records one server (`5xx`) error. Fires a `critical` alert when the count of
   * errors within the rolling window reaches the threshold and the cooldown has
   * elapsed. Never throws.
   */
  public recordServerError(observation: ServerErrorObservation = {}): void {
    const at = this.now();
    this.hits.push(at);
    this.prune(at);

    if (this.hits.length < this.threshold) {
      return;
    }
    if (this.lastAlertAt !== undefined && at - this.lastAlertAt < this.cooldownMs) {
      return;
    }

    this.lastAlertAt = at;
    this.notifier.sendAlert(this.buildAlert(observation, at));
  }

  /** Number of server errors currently retained within the window (testing/introspection). */
  public get currentCount(): number {
    return this.hits.length;
  }

  /** Drops observations that fell outside the rolling window ending at `at`. */
  private prune(at: number): void {
    const cutoff = at - this.windowMs;
    while (this.hits.length > 0 && (this.hits[0] as number) <= cutoff) {
      this.hits.shift();
    }
  }

  private buildAlert(observation: ServerErrorObservation, at: number): Alert {
    const context: Record<string, unknown> = {
      count: this.hits.length,
      threshold: this.threshold,
      window_ms: this.windowMs,
      observed_at: new Date(at).toISOString(),
    };
    if (observation.statusCode !== undefined) {
      context.last_status_code = observation.statusCode;
    }
    if (observation.path !== undefined) {
      context.last_path = observation.path;
    }
    if (observation.requestId !== undefined) {
      context.last_request_id = observation.requestId;
    }

    return {
      severity: 'critical',
      title: 'Server error rate threshold exceeded',
      description:
        `${this.hits.length} server (5xx) errors occurred within ${this.windowMs}ms ` +
        `(threshold ${this.threshold}). Investigate the backend for a systemic failure.`,
      context,
    };
  }
}
