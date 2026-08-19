/**
 * Public interface of the security module (task 43.4, Requirements 17.7, 17.8).
 *
 * Exposes the {@link ISecurityAuditLogger} abstraction and its default
 * structured-log implementation used to record security-relevant events
 * (authorization failures, suspicious activity such as rate-limit hits) as a
 * consistent, queryable audit stream. Authentication attempts continue to be
 * emitted by the auth module's structured event logger (composed, not
 * duplicated here).
 */
export {
  SECURITY_LOG_EVENT,
  SecurityEventLogger,
  NoopSecurityAuditLogger,
} from './security-event-logger.js';
export type {
  ISecurityAuditLogger,
  SecurityLogger,
  SecurityClock,
  SecurityEvent,
  SecurityEventCategory,
  SecurityEventOutcome,
  SecurityEventContextFields,
  AuthorizationDeniedInput,
  RateLimitExceededInput,
} from './security-event-logger.js';
