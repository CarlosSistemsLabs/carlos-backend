import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { AUTH_TOKENS, AUTHORIZATION_TOKENS, ADMINISTRATION_TOKENS } from '@infrastructure/di/index.js';
import { RegisterUserUseCase, BcryptPasswordHasher, type RegisterUserInput } from '@modules/auth/index.js';
import {
  CreateRoleUseCase,
  UpdateRolePermissionsUseCase,
  type CreateRoleInput,
  type UpdateRolePermissionsInput,
} from '@modules/authorization/index.js';
import { validateBody, validateParams, validateQuery } from '@presentation/validators/index.js';
import { AssignRoleToUserUseCase } from '../application/use-cases/assign-role-to-user.use-case.js';
import { GetAuditLogsUseCase } from '../application/use-cases/get-audit-logs.use-case.js';
import type {
  AssignRoleToUserInputDto,
  GetAuditLogsInputDto,
} from '../application/dto/administration-dtos.js';
import {
  createUserBodySchema,
  assignRoleBodySchema,
  createRoleBodySchema,
  updateRolePermissionsBodySchema,
  idParamSchema,
  auditLogsQuerySchema,
  createUserRouteSchema,
  assignRoleRouteSchema,
  createRoleRouteSchema,
  updateRolePermissionsRouteSchema,
  auditLogsRouteSchema,
} from './admin.schemas.js';

/**
 * The RBAC module gating the Administration endpoints.
 *
 * **Feature-gating decision:** administration is core tenant-management, NOT a
 * plan-tier feature — it is intentionally absent from the subscription
 * `PLAN_FEATURE_MATRIX`. These routes therefore attach NO `app.requireFeature`
 * guard; access is governed purely by authentication plus STRICT RBAC on the
 * `administration` module. Per the seeded system-role matrix only the Admin
 * role holds any `administration` grant (via its `*:*:*` wildcard); Manager and
 * User roles are explicitly excluded, so only tenant admins reach these
 * endpoints.
 */
const ADMIN_MODULE = 'administration';

/** Bundle of the admin use cases wired from the DI container. */
interface AdminUseCases {
  createUser: RegisterUserUseCase;
  assignRole: AssignRoleToUserUseCase;
  createRole: CreateRoleUseCase;
  updateRolePermissions: UpdateRolePermissionsUseCase;
  getAuditLogs: GetAuditLogsUseCase;
}

/**
 * Resolves the admin use cases from the composition container.
 *
 * User creation reuses the Auth module's {@link RegisterUserUseCase} (paired
 * with the bcrypt hasher, mirroring the auth routes) so password hashing and
 * per-tenant email uniqueness behave identically to self-service registration.
 * Role management reuses the Authorization module's {@link CreateRoleUseCase}
 * and {@link UpdateRolePermissionsUseCase}. The cross-module orchestration
 * ({@link AssignRoleToUserUseCase}) and the audit reader
 * ({@link GetAuditLogsUseCase}) live in this module.
 */
export function buildAdminUseCases(container: Container): AdminUseCases {
  const users = container.resolve(AUTH_TOKENS.UserRepository);
  const roles = container.resolve(AUTHORIZATION_TOKENS.RoleRepository);
  const auditLogs = container.resolve(ADMINISTRATION_TOKENS.AuditLogRepository);
  const hasher = new BcryptPasswordHasher();

  return {
    createUser: new RegisterUserUseCase(users, hasher),
    assignRole: new AssignRoleToUserUseCase(users, roles),
    createRole: new CreateRoleUseCase(roles),
    updateRolePermissions: new UpdateRolePermissionsUseCase(roles),
    getAuditLogs: new GetAuditLogsUseCase(auditLogs),
  };
}

/**
 * Returns the authenticated tenant id from the request.
 *
 * Defence in depth: every admin route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than operating without a tenant scope (Requirement 1.5).
 * The tenant an admin operates on is ALWAYS taken from the token, never the
 * client body/query, so an admin can never act across tenant boundaries.
 */
function requireTenantId(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return auth.tenantId;
}

/** Options accepted by the {@link adminRoutesPlugin}. */
export interface AdminRoutesOptions {
  /** Composition container with the administration/auth/authorization infra registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the tenant-administration endpoints under
 * `/api/v1/admin`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure) and `app.authorize('administration', screen, action)`
 * enforces RBAC (403 when the role lacks the permission — in practice every
 * role except Admin). There is deliberately no `app.requireFeature` guard —
 * administration is core tenant-management rather than a plan-tier feature.
 * Inputs are validated with Zod via the shared validators; validation failures
 * map to the consistent 400 envelope, a duplicate user email surfaces as 409
 * (`ConflictError`), a missing user/role as 404 (`NotFoundError`) and an
 * attempt to modify a system role's permissions as 422 (the domain
 * `SystemRoleModificationError` is a `BusinessRuleError`). The attached `schema`
 * objects document the routes for OpenAPI (Requirement 3.7); Fastify's own
 * validation is disabled inside this encapsulated plugin so it never
 * short-circuits the Zod checks. Mirrors the Sales/Cash/Reports module wiring.
 */
export const adminRoutesPlugin: FastifyPluginAsync<AdminRoutesOptions> = (app, opts) => {
  const useCases = buildAdminUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/admin/users — create a user in the caller's tenant
  app.post(
    '/users',
    {
      schema: createUserRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, 'users', 'write')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, createUserBodySchema);
      const input: RegisterUserInput = {
        tenantId,
        email: body.email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        roleId: body.roleId,
        ...(body.phone !== undefined && body.phone !== null ? { phone: body.phone } : {}),
      };
      const user = await useCases.createUser.execute(input);
      return reply.status(201).send(user);
    },
  );

  // PUT /api/v1/admin/users/:id/role — assign a role to a user
  app.put(
    '/users/:id/role',
    {
      schema: assignRoleRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, 'users', 'write')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, idParamSchema);
      const body = validateBody(request, assignRoleBodySchema);
      const input: AssignRoleToUserInputDto = { tenantId, userId: id, roleId: body.roleId };
      const user = await useCases.assignRole.execute(input);
      return reply.status(200).send(user);
    },
  );

  // POST /api/v1/admin/roles — create a custom role
  app.post(
    '/roles',
    {
      schema: createRoleRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, 'roles', 'write')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, createRoleBodySchema);
      const input: CreateRoleInput = {
        tenantId,
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
      };
      const role = await useCases.createRole.execute(input);
      return reply.status(201).send(role);
    },
  );

  // PUT /api/v1/admin/roles/:id/permissions — replace a role's permissions
  app.put(
    '/roles/:id/permissions',
    {
      schema: updateRolePermissionsRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, 'roles', 'write')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, idParamSchema);
      const body = validateBody(request, updateRolePermissionsBodySchema);
      const input: UpdateRolePermissionsInput = {
        tenantId,
        roleId: id,
        permissions: body.permissions,
      };
      const role = await useCases.updateRolePermissions.execute(input);
      return reply.status(200).send(role);
    },
  );

  // GET /api/v1/admin/audit-logs — retrieve audit logs (filterable, paginated)
  app.get(
    '/audit-logs',
    {
      schema: auditLogsRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, 'audit', 'read')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, auditLogsQuerySchema);
      const input: GetAuditLogsInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
        ...(query.entityId !== undefined ? { entityId: query.entityId } : {}),
        ...(query.userId !== undefined ? { userId: query.userId } : {}),
        ...(query.action !== undefined ? { action: query.action } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
      };
      const result = await useCases.getAuditLogs.execute(input);
      return reply.status(200).send(result);
    },
  );

  return Promise.resolve();
};

/**
 * Registers the admin routes under the `/api/v1/admin` prefix.
 *
 * Wraps {@link adminRoutesPlugin} in its own encapsulated context so the relaxed
 * validator compiler does not leak to other routes.
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(adminRoutesPlugin, { prefix: '/api/v1/admin', container });
}
