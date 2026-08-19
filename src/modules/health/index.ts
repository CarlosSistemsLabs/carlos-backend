/**
 * Public interface of the Health module (task 31.2, Requirement 21.4).
 *
 * Exposes the readiness health-check registry + abstractions and the public
 * `/health/liveness` and `/health/readiness` route registration.
 */
export {
  type HealthStatus,
  type HealthCheckResult,
  type HealthReport,
  type IHealthCheck,
  HealthCheckRegistry,
  PingHealthCheck,
  createDatabaseHealthCheck,
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
} from './application/health-check.js';
export {
  registerHealthRoutes,
  healthRoutesPlugin,
  type HealthRoutesOptions,
} from './presentation/health.routes.js';
