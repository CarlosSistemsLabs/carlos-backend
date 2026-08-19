import type { Alert, IAlertNotifier } from './alert.js';

/**
 * Suspicious-activity detector (task 31.4, Requirements 17.8, 17.7).
 *
 * A rolling-window detector for security-relevant patterns. Signals are grouped
 * by `(kind, key)` — e.g. repeated failed logins for the same email, or repeated
 * authorization failures from the same user/IP. When the number of signals for a
 * group within the window reaches the threshold, a `critical` alert is raised
 * through the {@link IAlertNotifier} port so administrators are notified within
 * the required window (Requirement 17.8 — within 5 minutes).
 *
 * ## Sources / signals
 * - `failed_login` / `account_locked` — fed from the authentication flow via the
 *   {@link IAuthEventLogger} decorator (`DetectingAuthEventLogger`), keyed by the
 *   attempted email (falling back to IP/user). This complements the existing
 *   auth event logging without changing the auth use cases.
 * - `authz_failure` — fed from the central error handler on `401`/`403` bursts,
 *   keyed by the authenticated user id (falling back to IP).
 *
 * ## Per-group cooldown (anti-alert-storm)
 * Each `(kind, key)` group has its own cooldown so a single attacker hammering
 * one account produces one alert per `cooldownMs`, while a different account
 * crossing the threshold still alerts independently.
 */
export interface SuspiciousActivityDetectorOptions {
  /** Number of signals for a group within the window that trips the alert (> 0). */
  readonly threshold: number;
  /** Rolling-window length in milliseconds (> 0). */
  readonly windowMs: number;
  /** Minimum gap between two alerts for the SAME group in milliseconds (>= 0). */
  readonly cooldownMs: number;
  /** Injectable clock (milliseconds); defaults to {@link Date.now}. */
  readonly now?: () => number;
}

/** A single security-relevant signal fed to the detector. */
export interface SuspiciousActivitySignal {
  /** Signal category, e.g. `failed_login`, `account_locked`, `authz_failure`. */
  readonly kind: string;
  /** Grouping key: attempted email, IP address, or user id. */
  readonly key: string;
  /** Non-sensitive extra context attached to a fired alert. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Narrow port the auth-event decorator depends on, so the auth module needs only
 * this contract rather than the concrete detector.
 */
export interface ISuspiciousActivityDetector {
  record(signal: SuspiciousActivitySignal): void;
}

export class SuspiciousActivityDetector implements ISuspiciousActivityDetector {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  /** Signal timestamps (ms) per `(kind:key)` group, within the current window. */
  private readonly hitsByGroup = new Map<string, number[]>();
  /** Timestamp of the last alert per group. */
  private readonly lastAlertAtByGroup = new Map<string, number>();

  constructor(
    private readonly notifier: IAlertNotifier,
    options: SuspiciousActivityDetectorOptions,
  ) {
    if (options.threshold <= 0) {
      throw new Error('SuspiciousActivityDetector threshold must be a positive integer');
    }
    if (options.windowMs <= 0) {
      throw new Error('SuspiciousActivityDetector windowMs must be a positive integer');
    }
    if (options.cooldownMs < 0) {
      throw new Error('SuspiciousActivityDetector cooldownMs must be non-negative');
    }
    this.threshold = options.threshold;
    this.windowMs = options.windowMs;
    this.cooldownMs = options.cooldownMs;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Records one suspicious signal. Fires a `critical` alert when the group's
   * count within the rolling window reaches the threshold and the group's
   * cooldown has elapsed. Never throws.
   */
  public record(signal: SuspiciousActivitySignal): void {
    const group = `${signal.kind}:${signal.key}`;
    const at = this.now();

    const hits = this.hitsByGroup.get(group) ?? [];
    hits.push(at);
    this.prune(hits, at);
    this.hitsByGroup.set(group, hits);

    if (hits.length < this.threshold) {
      return;
    }
    const lastAlertAt = this.lastAlertAtByGroup.get(group);
    if (lastAlertAt !== undefined && at - lastAlertAt < this.cooldownMs) {
      return;
    }

    this.lastAlertAtByGroup.set(group, at);
    this.notifier.sendAlert(this.buildAlert(signal, hits.length, at));
  }

  /** Number of signals currently retained for a group (testing/introspection). */
  public countFor(kind: string, key: string): number {
    return this.hitsByGroup.get(`${kind}:${key}`)?.length ?? 0;
  }

  /** Drops signals that fell outside the rolling window ending at `at`. */
  private prune(hits: number[], at: number): void {
    const cutoff = at - this.windowMs;
    while (hits.length > 0 && (hits[0] as number) <= cutoff) {
      hits.shift();
    }
  }

  private buildAlert(
    signal: SuspiciousActivitySignal,
    count: number,
    at: number,
  ): Alert {
    return {
      severity: 'critical',
      title: `Suspicious activity detected: ${signal.kind}`,
      description:
        `${count} '${signal.kind}' events for key '${signal.key}' within ${this.windowMs}ms ` +
        `(threshold ${this.threshold}). Possible brute-force or abuse.`,
      context: {
        kind: signal.kind,
        key: signal.key,
        count,
        threshold: this.threshold,
        window_ms: this.windowMs,
        observed_at: new Date(at).toISOString(),
        ...(signal.context ?? {}),
      },
    };
  }
}
