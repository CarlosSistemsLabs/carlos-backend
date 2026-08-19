import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance } from 'fastify';

/** Header used to carry the request correlation id across services and clients. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Resolves the request id for an incoming request.
 *
 * Reuses an inbound `x-request-id` header when present (so a correlation id set
 * by an upstream gateway or client is preserved), otherwise mints a new UUID.
 *
 * Designed to be passed to Fastify's `genReqId` option. Fastify only calls
 * `genReqId` when the configured `requestIdHeader` is absent, so this also
 * defensively reads the header to remain correct if used standalone.
 */
export function resolveRequestId(req: { headers: IncomingHttpHeaders }): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const incoming = Array.isArray(header) ? header[0] : header;
  if (typeof incoming === 'string' && incoming.trim().length > 0) {
    return incoming.trim();
  }
  return randomUUID();
}

/**
 * Registers a hook that echoes the resolved request id back to the client on the
 * `x-request-id` response header, enabling end-to-end request tracing.
 *
 * The id itself is established by Fastify via `requestIdHeader` + `genReqId`
 * (see {@link resolveRequestId} wired in the server factory), which means
 * `request.id` already reflects the inbound header or a generated UUID.
 */
export function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
}
