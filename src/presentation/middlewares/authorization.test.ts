import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerErrorHandler } from './error-handler.js';
import { registerAuthorization } from './authorization.js';
import { Role, Permission, type IRoleRepository } from '@modules/authorization/index.js';
import type { AuthenticatedPayload } from './tenant-context.js';
import type { ISecurityAuditLogger } from '@common/security';

const TENANT_ID = 'tenant-abc';
const ROLE_ID = 'role-xyz';
const USER_ID = 'user-123';

/** Builds a role granting the supplied permission triples. */
function roleWith(...triples: ReadonlyArray<[string, string, string]>): Role {
  return Role.create(
    {
      tenantId: TENANT_ID,
      name: 'Test Role',
      permissions: triples.map(([m, s, a]) => Permission.create(m, s, a)),
    },
    ROLE_ID,
  );
}

/** Builds a mock {@link IRoleRepository} whose `findById` returns `role`. */
function makeRoleRepository(role: Role | null): IRoleRepository {
  return {
    findById: vi.fn(async (id: string) => (role !== null && role.id === id ? role : null)),
    findByTenant: vi.fn().mockResolvedValue([]),
    findByName: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    addPermissions: vi.fn(),
    replacePermissions: vi.fn(),
  };
}

/**
 * Builds a test app where a tiny `seedAuth` preHandler stands in for the real
 * authentication guard, attaching `request.auth` so we can exercise the
 * authorization guard in isolation. When `auth` is `undefined` the route
 * simulates an unauthenticated request reaching `app.authorize`.
 */
async function buildApp(
  role: Role | null,
  auth: AuthenticatedPayload | null = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    roleId: ROLE_ID,
  },
): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  registerAuthorization(app, makeRoleRepository(role));

  const seedAuth = (request: FastifyRequest, _reply: unknown, done: () => void): void => {
    if (auth !== null) {
      request.auth = auth;
    }
    done();
  };

  app.get(
    '/products',
    { preHandler: [seedAuth, app.authorize('products', 'list', 'read')] },
    () => ({ ok: true }),
  );

  await app.ready();
  return app;
}

describe('authorization middleware', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 when the role has the exact permission', async () => {
    app = await buildApp(roleWith(['products', 'list', 'read']));

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns 200 when the role has a wildcard permission', async () => {
    app = await buildApp(roleWith(['*', '*', '*']));

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns 403 when the role lacks the required permission', async () => {
    app = await buildApp(roleWith(['products', 'list', 'write']));

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe('FORBIDDEN');
  });

  it('returns 403 when the role cannot be found', async () => {
    app = await buildApp(null);

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe('FORBIDDEN');
  });

  it('returns 401 when the request is unauthenticated', async () => {
    app = await buildApp(roleWith(['products', 'list', 'read']), null);

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe('UNAUTHORIZED');
  });
});

/** Builds a spy {@link ISecurityAuditLogger} capturing emitted denials. */
function makeSecurityAudit(): ISecurityAuditLogger & {
  authorizationDenied: ReturnType<typeof vi.fn>;
  rateLimitExceeded: ReturnType<typeof vi.fn>;
} {
  return {
    authorizationDenied: vi.fn(),
    rateLimitExceeded: vi.fn(),
  };
}

/** Builds a test app with an injected security-audit logger (task 43.4). */
async function buildAuditedApp(
  role: Role | null,
  securityAudit: ISecurityAuditLogger,
): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  registerAuthorization(app, makeRoleRepository(role), securityAudit);

  const seedAuth = (request: FastifyRequest, _reply: unknown, done: () => void): void => {
    request.auth = { tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID };
    done();
  };

  app.get(
    '/products',
    { preHandler: [seedAuth, app.authorize('products', 'list', 'read')] },
    () => ({ ok: true }),
  );

  await app.ready();
  return app;
}

describe('authorization middleware security auditing (task 43.4, Requirement 17.7)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('emits a security-audit line with the attempted action when permission is missing', async () => {
    const audit = makeSecurityAudit();
    app = await buildAuditedApp(roleWith(['products', 'list', 'write']), audit);

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(403);
    expect(audit.authorizationDenied).toHaveBeenCalledTimes(1);
    expect(audit.authorizationDenied.mock.calls[0]?.[0]).toMatchObject({
      module: 'products',
      screen: 'list',
      action: 'read',
      reason: 'missing_permission',
      tenantId: TENANT_ID,
      userId: USER_ID,
    });
  });

  it('emits a security-audit line with reason role_not_found when the role is gone', async () => {
    const audit = makeSecurityAudit();
    app = await buildAuditedApp(null, audit);

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(403);
    expect(audit.authorizationDenied).toHaveBeenCalledTimes(1);
    expect(audit.authorizationDenied.mock.calls[0]?.[0]).toMatchObject({
      module: 'products',
      screen: 'list',
      action: 'read',
      reason: 'role_not_found',
    });
  });

  it('does NOT emit a security-audit line when access is granted', async () => {
    const audit = makeSecurityAudit();
    app = await buildAuditedApp(roleWith(['products', 'list', 'read']), audit);

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(200);
    expect(audit.authorizationDenied).not.toHaveBeenCalled();
  });
});
