/**
 * Public interface of the crash / error-reporting module (task 33.3,
 * Requirements 13.6, 21.8).
 *
 * Exposes the {@link ICrashReporter} abstraction (the external crash-service
 * seam), its structured-log default implementation, and a no-op implementation
 * for disabled/test wiring. See {@link crash-reporter} for how this reconciles
 * with the task 31.4 error tracking and why the actual Crashlytics integration
 * lives in the Android/iOS clients.
 */
export {
  type CrashContext,
  type ICrashReporter,
  type CrashReporterLogger,
  type CrashReporterClock,
  type CrashReport,
  CRASH_REPORT_EVENT,
  buildCrashReport,
  StructuredLogCrashReporter,
  NoopCrashReporter,
} from './crash-reporter.js';
