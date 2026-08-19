/**
 * Public interface of the alerting module (task 31.4, Requirements 17.8, 21.5,
 * 21.7).
 *
 * Exposes the {@link IAlertNotifier} abstraction (the pager/Slack seam), the
 * log-based default notifier, and the two rolling-window monitors that raise
 * alerts through it: the critical-error-rate monitor and the suspicious-activity
 * detector.
 */
export {
  type AlertSeverity,
  type Alert,
  type IAlertNotifier,
  type AlertLogger,
  ALERT_EVENT,
  LogAlertNotifier,
} from './alert.js';
export {
  type ErrorRateMonitorOptions,
  type ServerErrorObservation,
  ErrorRateMonitor,
} from './error-rate-monitor.js';
export {
  type SuspiciousActivityDetectorOptions,
  type SuspiciousActivitySignal,
  type ISuspiciousActivityDetector,
  SuspiciousActivityDetector,
} from './suspicious-activity-detector.js';
