import type { FastifyInstance, FastifyRequest } from 'fastify';
import { setTenantId, setUserId } from '@common/context';

/**
 * Shape of the verified authentication payload attached to a request once a JWT
 * has been decoded and validated.
 *
 * TODO(task 8.2): the JWT service/auth middleware will verify the bearer token
 * and assign this object to `request.auth`. Until then no middleware populates
 * it, so the tenant-context hook below is a safe no-op.
 */
export interface AuthenticatedPayload {
  /** Tenant the authenticated subject belongs to (drives data isolation). */
  tenantId: string;
  /** Authenticated user id. */
  userId: string;
  /** Role granted to the user, used for RBAC authorization. */
  roleId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Verified authentication payload, set by the auth middleware (task 8.2)
     * after decoding the JWT. Absent on unauthenticated/public requests.
     */
    auth?: AuthenticatedPayload;
  }
}

/**
 * Propagates the verified authentication payload from the request onto the
 * active {@link RequestContext} so downstream layers (use cases, repositories,
 * Prisma tenant filter) can read the tenant/user ids via the context accessors.
 *
 * Defensive by design: if no verified payload is present on the request, this
 * is a no-op. This keeps the platform correct before JWT verification is wired
 * (task 8.2) and for genuinely public/unauthenticated routes.
 */
export function propagateTenantContext(request: Pick<FastifyRequest, 'auth'>): void {
  const auth = request.auth;
  if (auth === undefined) {
    return;
  }
  if (auth.tenantId.length > 0) {
    setTenantId(auth.tenantId);
  }
  if (auth.userId.length > 0) {
    setUserId(auth.userId);
  }
}

/**
 * Registers the tenant-context propagation hook.
 *
 * Runs as a `preHandler` so it executes after authentication has had a chance
 * to attach the verified payload (task 8.2) but before route handlers run. The
 * request context itself is seeded earlier by the request-context `onRequest`
 * hook, so {@link setTenantId}/{@link setUserId} have a live store to write to.
 */
export function registerTenantContext(app: FastifyInstance): void {
  app.addHook('preHandler', (request, _reply, done) => {
    propagateTenantContext(request);
    done();
  });
}
