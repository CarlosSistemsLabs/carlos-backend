import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@domain/errors/index.js';
import type { IRoleRepository } from '@modules/authorization/index.js';
import type { ISecurityAuditLogger } from '@common/security';
import { NoopSecurityAuditLogger } from '@common/security';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Route-level RBAC guard factory. Given a `module`/`screen`/`action`
     * triple, returns a `preHandler` that verifies the authenticated user's
     * role grants that permission. Attach it after {@link FastifyInstance.authenticate}:
     *
     * ```ts
     * app.get('/api/v1/products', {
     *   preHandler: [app.authenticate, app.authorize('products', 'list', 'read')],
     * }, handler);
     * ```
     */
    authorize: AuthorizeFactory;
  }
}

/**
 * Factory that produces a permission-checking `preHandler` for a specific
 * `module`/`screen`/`action` triple. Returned from {@link createAuthorizeFactory}
 * and exposed on the Fastify instance as `app.authorize`.
 */
export type AuthorizeFactory = (
  module: string,
  screen: string,
  action: string,
) => preHandlerHookHandler;

/**
 * Builds the {@link AuthorizeFactory} bound to a {@link IRoleRepository}.
 *
 * **Permission resolution strategy — Option A (load on demand):** rather than
 * embedding the full permission list in the JWT (which would go stale until the
 * next token refresh), the produced guard loads the user's {@link Role} — with
 * its permissions — fresh from the repository on each protected request using
 * the `roleId` carried by the verified JWT (`request.auth.roleId`). This means
 * permission grants and revocations take effect immediately, which is the safer
 * default for authorization. The JWT therefore only needs to carry `roleId`
 * (its current shape), not the permission set. Caching the role/permission
 * lookup (e.g. behind the multi-level cache) is a future optimisation tracked
 * by task 39; the repository port stays the same so that change is transparent
 * to this middleware.
 *
 * The role lookup is tenant-scoped: by the time this `preHandler` runs the
 * tenant-context hook has already copied `request.auth.tenantId` into the
 * request context, so the repository (and its Prisma tenant filter) resolves
 * the role within the caller's tenant boundary.
 *
 * Returned guard behaviour:
 * - No verified payload on the request → {@link UnauthorizedError} (401). The
 *   route is expected to also attach `app.authenticate`; this is defence in
 *   depth in case `authorize` is used without it.
 * - Role not found (e.g. deleted) → {@link ForbiddenError} (403): an
 *   authenticated subject whose role no longer grants access is denied.
 * - Role lacks the requested permission → {@link ForbiddenError} (403).
 *   Wildcard (`*`) grants on any of module/screen/action are honoured by the
 *   {@link Role.hasPermission}/{@link Permission} value object.
 *
 * Both errors are mapped to the consistent error envelope by the central error
 * handler.
 */
export function createAuthorizeFactory(
  roleRepository: IRoleRepository,
  securityAudit: ISecurityAuditLogger = new NoopSecurityAuditLogger(),
): AuthorizeFactory {
  return function authorize(module, screen, action): preHandlerHookHandler {
    return async function authorizePreHandler(request: FastifyRequest): Promise<void> {
      const auth = request.auth;
      if (auth === undefined) {
        throw new UnauthorizedError('Authentication required');
      }

      const role = await roleRepository.findById(auth.roleId);
      if (role === null) {
        auditDenial(securityAudit, request, auth, module, screen, action, 'role_not_found');
        throw new ForbiddenError('Access denied');
      }

      if (!role.hasPermission(module, screen, action)) {
        auditDenial(securityAudit, request, auth, module, screen, action, 'missing_permission');
        throw new ForbiddenError(`Missing permission for ${module}:${screen}:${action}`, {
          module,
          screen,
          action,
        });
      }
    };
  };
}

/**
 * Emits a structured security-audit line for an authorization denial
 * (Requirement 17.7). Captures the acting subject (`tenantId`/`userId` from the
 * verified JWT payload), the attempted `module`/`screen`/`action`, the denial
 * `reason`, and the request correlation id — never any credential/token.
 */
function auditDenial(
  securityAudit: ISecurityAuditLogger,
  request: FastifyRequest,
  auth: NonNullable<FastifyRequest['auth']>,
  module: string,
  screen: string,
  action: string,
  reason: 'missing_permission' | 'role_not_found',
): void {
  securityAudit.authorizationDenied({
    module,
    screen,
    action,
    reason,
    tenantId: auth.tenantId,
    userId: auth.userId,
    ipAddress: request.ip,
    requestId: request.id,
  });
}

/**
 * Registers the authorization guard factory as the `authorize` decorator on the
 * Fastify instance so protected routes can reference it via
 * `{ preHandler: [app.authenticate, app.authorize(module, screen, action)] }`.
 *
 * The factory is wired to the role repository resolved from the composition
 * root container, mirroring how {@link registerAuthentication} wires the token
 * service into `app.authenticate`.
 *
 * An optional {@link ISecurityAuditLogger} (task 43.4, Requirement 17.7) is
 * threaded into the guard so every authorization denial emits a structured
 * security-audit line (actor/tenant/attempted `module:screen:action`); when
 * omitted a {@link NoopSecurityAuditLogger} preserves the prior behaviour.
 */
export function registerAuthorization(
  app: FastifyInstance,
  roleRepository: IRoleRepository,
  securityAudit?: ISecurityAuditLogger,
): void {
  app.decorate('authorize', createAuthorizeFactory(roleRepository, securityAudit));
}
