import type { FastifyInstance } from 'fastify';
import { getTenantId, getUserId } from '@common/context';

/**
 * Emits one structured log line per completed request capturing the fields
 * required by Requirement 21.2: `request_id`, `tenant_id`, `user_id`, `method`,
 * `path`, `status_code`, and `duration`.
 *
 * The full Pino configuration (JSON output, redaction, ISO timestamp, level and
 * the context `mixin`) lives in `@common/logging` and is wired into Fastify in
 * `@config/server` (task 31.1). That `mixin` already stamps
 * `request_id`/`tenant_id`/`user_id` on every log line while inside a request
 * scope. This hook is retained as the authoritative per-response summary: it
 * emits the full Requirement 21.2 field set explicitly — including `tenant_id`/
 * `user_id` as `null` when unauthenticated — so the request record is complete
 * and deterministic regardless of context population. Where the summary and the
 * mixin set the same key, the values passed here take precedence, so no field is
 * emitted twice. `tenant_id`/`user_id` are read from the request context and are
 * populated once the auth middleware runs (task 6.2).
 */
export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        request_id: request.id,
        tenant_id: getTenantId() ?? null,
        user_id: getUserId() ?? null,
        method: request.method,
        path: request.url,
        status_code: reply.statusCode,
        duration: reply.elapsedTime,
      },
      'request completed',
    );
    done();
  });
}
