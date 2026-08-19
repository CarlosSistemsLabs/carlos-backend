/**
 * Public interface of the observability / performance-metrics module
 * (task 31.3, Requirements 21.6, 21.3).
 *
 * Exposes the {@link IMetrics} abstraction (the OpenTelemetry seam), the
 * in-process {@link InMemoryMetrics} implementation, the Fastify request-metrics
 * hook, and the `/metrics` scrape route registration.
 */
export {
  type StatusClass,
  type RequestMetricSample,
  type LatencySummary,
  type RouteMetricsSnapshot,
  type CustomTraceSnapshot,
  type MemorySnapshot,
  type MetricsSnapshot,
  type IMetrics,
  STATUS_CLASSES,
  DEFAULT_RESERVOIR_CAPACITY,
  statusClassOf,
  nearestRankPercentile,
  Reservoir,
  InMemoryMetrics,
  timeDbOperation,
} from './metrics.js';
export { normalizeRoute, registerRequestMetrics } from './request-metrics.js';
export {
  type MetricsRoutesOptions,
  metricsRoutesPlugin,
  registerMetricsRoutes,
} from './metrics.routes.js';
export {
  type TraceHandle,
  type IPerformanceTracer,
  MetricsPerformanceTracer,
  NoopPerformanceTracer,
} from './performance-tracer.js';
