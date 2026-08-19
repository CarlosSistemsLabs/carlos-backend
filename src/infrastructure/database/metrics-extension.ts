import { Prisma } from '@prisma/client';
import { type IMetrics, timeDbOperation } from '@common/monitoring';

/**
 * Prisma client extension that times every database operation and feeds the
 * duration into the metrics registry (task 31.3, Requirement 21.6 — database
 * query time).
 *
 * ## Why an extension (and not `$on('query')`)
 * Prisma's `$on('query')` event requires the client to be constructed with
 * `log: [{ level: 'query', emit: 'event' }]` — changing the base client's log
 * configuration (currently `resolvePrismaLogLevels`) and its type. That is
 * intrusive and would ripple through the existing client wiring and its tests.
 * A client extension is additive: it wraps each operation via the same
 * `$allOperations` hook the tenant-isolation extension already uses, measures
 * wall-clock duration, and returns the untouched result — existing behavior is
 * never altered. The duration is recorded whether the query resolves or rejects.
 *
 * ## Integration point (not auto-applied)
 * This factory is intentionally NOT applied to the shared `prisma`/`tenantPrisma`
 * clients by default, to keep the change non-breaking (applying `$extends`
 * returns a new client instance/type). To enable DB-query metrics in a
 * deployment, apply it at composition time, e.g.:
 *
 * ```ts
 * const timedPrisma = prisma.$extends(createDbMetricsExtension(metrics));
 * const tenantPrisma = timedPrisma.$extends(tenantIsolationExtension);
 * ```
 *
 * Application code can also feed durations directly via
 * {@link IMetrics.recordDbQuery} (or the {@link timeDbOperation} helper) where a
 * repository already measures its own timing.
 */
export function createDbMetricsExtension(metrics: IMetrics) {
  return Prisma.defineExtension({
    name: 'db-metrics',
    query: {
      $allModels: {
        $allOperations: ({ args, query }) =>
          timeDbOperation(metrics, () => query(args)),
      },
    },
  });
}
