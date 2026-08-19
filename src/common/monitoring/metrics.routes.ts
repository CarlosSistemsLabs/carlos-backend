import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { IMetrics } from './metrics.js';

/**
 * Options accepted by the metrics route plugin.
 */
export interface MetricsRoutesOptions {
  /** Registry whose snapshot is serialized by the endpoint. */
  metrics: IMetrics;
  /**
   * When `false`, the route is not registered at all. Lets deployments disable
   * the scrape endpoint entirely via configuration. Defaults to `true`.
   */
  enabled?: boolean;
}

const latencySchema = {
  type: 'object',
  properties: {
    count: { type: 'integer' },
    min: { type: 'number' },
    max: { type: 'number' },
    p50: { type: 'number' },
    p95: { type: 'number' },
    p99: { type: 'number' },
  },
  required: ['count', 'min', 'max', 'p50', 'p95', 'p99'],
} as const;

const statusClassesSchema = {
  type: 'object',
  properties: {
    '1xx': { type: 'integer' },
    '2xx': { type: 'integer' },
    '3xx': { type: 'integer' },
    '4xx': { type: 'integer' },
    '5xx': { type: 'integer' },
  },
  required: ['1xx', '2xx', '3xx', '4xx', '5xx'],
} as const;

const metricsOutputSchema = {
  type: 'object',
  properties: {
    timestamp: { type: 'string' },
    uptimeSeconds: { type: 'number' },
    requests: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        ratePerSecond: { type: 'number' },
        statusClasses: statusClassesSchema,
        errorRate: { type: 'number' },
        clientErrorRate: { type: 'number' },
        latency: latencySchema,
      },
      required: [
        'total',
        'ratePerSecond',
        'statusClasses',
        'errorRate',
        'clientErrorRate',
        'latency',
      ],
    },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          method: { type: 'string' },
          route: { type: 'string' },
          count: { type: 'integer' },
          statusClasses: statusClassesSchema,
          latency: latencySchema,
        },
        required: ['method', 'route', 'count', 'statusClasses', 'latency'],
      },
    },
    dbQuery: latencySchema,
    activeConnections: { type: 'integer' },
    memory: {
      type: 'object',
      properties: {
        rss: { type: 'integer' },
        heapTotal: { type: 'integer' },
        heapUsed: { type: 'integer' },
        external: { type: 'integer' },
        arrayBuffers: { type: 'integer' },
      },
      required: ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'],
    },
  },
  required: [
    'timestamp',
    'uptimeSeconds',
    'requests',
    'routes',
    'dbQuery',
    'activeConnections',
    'memory',
  ],
} as const;

const metricsRouteSchema = {
  tags: ['Observability'],
  summary: 'Performance metrics snapshot (request/error rate, latency, DB, memory)',
  response: {
    200: metricsOutputSchema,
  },
} as const;

/**
 * Fastify plugin exposing `GET /metrics` returning the current metrics snapshot
 * as JSON (task 31.3, Requirement 21.6).
 *
 * ## Auth decision (security note — Requirement: do not expose sensitive
 * internals publicly)
 * The endpoint is **UNAUTHENTICATED**, mirroring the conventional Prometheus
 * `/metrics` scrape target. The snapshot contains only operational aggregates
 * (counts, latency percentiles, memory) — NO tenant data, PII, tokens, or
 * business records — and route labels are collapsed to patterns, so it does not
 * leak sensitive internals. It lives OUTSIDE the `/api/v1` prefix at `/metrics`
 * and, like the health probes, attaches no auth/RBAC/feature guard.
 *
 * In production this endpoint MUST be network-restricted (scraped over an
 * internal network / behind the ingress, not exposed publicly). Deployments
 * that cannot network-isolate it can disable it entirely via the `enabled`
 * option (wired to the `METRICS_ENABLED` env flag in `buildServer`).
 */
export const metricsRoutesPlugin: FastifyPluginAsync<MetricsRoutesOptions> = (app, opts) => {
  const enabled = opts.enabled ?? true;
  if (!enabled) {
    return Promise.resolve();
  }

  app.get('/metrics', { schema: metricsRouteSchema }, (_request, reply) => {
    return reply.status(200).send(opts.metrics.snapshot());
  });

  return Promise.resolve();
};

/**
 * Registers the metrics scrape endpoint on the application at `/metrics`
 * (no prefix, no auth). No-op when `options.enabled` is `false`.
 */
export async function registerMetricsRoutes(
  app: FastifyInstance,
  options: MetricsRoutesOptions,
): Promise<void> {
  await app.register(metricsRoutesPlugin, options);
}
