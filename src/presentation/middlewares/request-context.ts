import type { FastifyInstance } from 'fastify';
import { enterContext } from '@common/context';

/**
 * Seeds the per-request {@link RequestContext} at the very start of the request
 * lifecycle so correlation data (and later tenant/user ids) are available to
 * every layer via the AsyncLocalStorage accessors.
 *
 * `tenantId`/`userId` are intentionally left unset here; the auth middleware
 * populates them after decoding the JWT (task 6.2).
 */
export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    enterContext({ requestId: request.id });
    done();
  });
}
