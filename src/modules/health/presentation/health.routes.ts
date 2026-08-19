import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  type HealthCheckRegistry,
} from '../application/health-check.js';
import { livenessRouteSchema, readinessRouteSchema } from './health.schemas.js';

/**
 * Options accepted by the health route plugin.
 */
export interface HealthRoutesOptions {
  /** Registry whose checks drive the readiness probe. */
  registry: HealthCheckRegistry;
  /** Per-check timeout (ms) for the readiness probe. Defaults to 2000ms. */
  readinessTimeoutMs?: number;
}

/**
 * Fastify plugin exposing the orchestration health probes.
 *
 * **Both routes are PUBLIC** — no authentication, no RBAC (`authorize`) and no
 * feature gating (`requireFeature`). Container orchestrators (Kubernetes,
 * Railway, load balancers) probe these unauthenticated endpoints; requiring a
 * token would break the probe. Routes in this codebase opt into auth per-route,
 * so simply attaching no `preHandler` guard leaves them open. They live OUTSIDE
 * the `/api/v1` prefix (at `/health/*`) because they are operational endpoints,
 * not part of the versioned public API.
 *
 * - `GET /health/liveness` → **always** `200 { status: 'ok' }`. Liveness answers
 *   only "is this process alive?" and deliberately performs NO dependency
 *   checks. Per orchestration best practice a liveness probe must not fail when
 *   a downstream (database, cache) is down — otherwise the orchestrator would
 *   kill and restart a perfectly healthy process during a transient dependency
 *   outage, turning a recoverable blip into a crash loop. It must also be cheap.
 *
 * - `GET /health/readiness` → runs the registered checks (database connectivity
 *   today; Redis / external services once wired). `200 { status: 'ready',
 *   checks: { database: 'up', … } }` when all critical checks pass; `503
 *   { status: 'not_ready', checks: { … } }` when any critical check is down
 *   (Requirement 21.4). Each check runs behind a timeout so a hung dependency
 *   is reported `down` rather than hanging the probe.
 */
export const healthRoutesPlugin: FastifyPluginAsync<HealthRoutesOptions> = (app, opts) => {
  const readinessTimeoutMs = opts.readinessTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

  app.get('/health/liveness', { schema: livenessRouteSchema }, (_request, reply) => {
    // Dependency-free by design: never fails due to a downstream being down.
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/health/readiness', { schema: readinessRouteSchema }, async (_request, reply) => {
    const report = await opts.registry.runAll(readinessTimeoutMs);
    const statusCode = report.status === 'ready' ? 200 : 503;
    return reply.status(statusCode).send(report);
  });

  return Promise.resolve();
};

/**
 * Registers the public health probes on the application at `/health/liveness`
 * and `/health/readiness` (no prefix, no auth). Should be registered early in
 * the bootstrap so probes are reachable regardless of the rest of the wiring.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions,
): Promise<void> {
  await app.register(healthRoutesPlugin, options);
}
