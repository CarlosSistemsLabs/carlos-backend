import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IMetrics } from './metrics.js';

/**
 * Request-metrics Fastify hook (task 31.3, Requirement 21.6).
 *
 * This is a SEPARATE concern from the structured request-logging hook
 * (`@presentation/middlewares/request-logging`): logging emits one human/machine
 * readable line per request; metrics aggregate counters + latency distributions
 * for scraping. Both `onResponse` hooks coexist without interfering.
 *
 * - `onRequest` increments the in-flight (active connections) gauge.
 * - `onResponse` decrements the gauge and records the request (method, route,
 *   status code, `reply.elapsedTime`). `onResponse` fires for successful AND
 *   errored responses (the error handler still sends a response), so the gauge
 *   is balanced and error responses are counted — no separate `onError`
 *   decrement is needed (that would double-count, since `onError` is followed by
 *   `onResponse`).
 */

/**
 * Normalizes a request to its ROUTE PATTERN label, e.g.
 * `GET /api/v1/products/:id` rather than `/api/v1/products/123`.
 *
 * Using `request.routeOptions.url` (the matched route template) instead of the
 * raw `request.url` is essential to avoid **label-cardinality explosion**: every
 * distinct id/uuid in a raw URL would otherwise create a new time series,
 * unbounded in a multi-tenant system with millions of entities. Requests that
 * match no route (404s) have no template; they are bucketed under a single
 * `unmatched` label so they likewise cannot explode cardinality.
 */
export function normalizeRoute(request: Pick<FastifyRequest, 'routeOptions'>): string {
  const url = request.routeOptions?.url;
  return typeof url === 'string' && url.length > 0 ? url : 'unmatched';
}

/**
 * Registers the request-metrics hooks on the Fastify instance, feeding the
 * supplied {@link IMetrics} registry. Depends only on the interface so an
 * OpenTelemetry/Prometheus-backed implementation can be substituted with no hook
 * change.
 */
export function registerRequestMetrics(app: FastifyInstance, metrics: IMetrics): void {
  app.addHook('onRequest', (_request, _reply, done) => {
    metrics.incrementInFlight();
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    metrics.decrementInFlight();
    metrics.recordRequest({
      method: request.method,
      route: normalizeRoute(request),
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
    done();
  });
}
