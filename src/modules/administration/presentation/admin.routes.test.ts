import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Container,
  AUTH_TOKENS,
  AUTHORIZATION_TOKENS,
  ADMINISTRATION_TOKENS,
} from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { JwtTokenService } from '../../auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../auth/domain/entities/auth-user.js';
import type {
  IUserRepository,
  ListUsersQuery,
} from '../../auth/domain/repositories/user-repository.js';
import { Role } from '../../authorization/domain/entities/role.js';
import { Permission } from '../../authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../authorization/domain/repositories/role-repository.js';
import type {
  AuditLogQuery,
  AuditLogRecord,
  IAuditLogRepository,
} from '../domain/repositories/audit-log-repository.js';
import { registerAdminRoutes } from './admin.routes.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const MANAGER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const SYSTEM_ROLE_ID = '55555555-5555-5555-5555-555555555555';
const CUSTOM_ROLE_ID = '66666666-6666-6666-6666-666666666666';
const EXISTING_USER_ID = '77777777-7777-7777-7777-777777777777';
const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemoryUserRepository implements IUserRepository {
  private readonly byId = new Map<UUID, AuthUser>();
  private readonly byEmail = new Map<string, AuthUser>();

  seed(user: AuthUser): void {
    this.byId.set(user.id, user);
    this.byEmail.set(`${user.tenantId}:${user.email}`, user);
  }

  async findByEmail(tenantId: UUID, email: string): Promise<AuthUser | null> {
    return this.byEmail.get(`${tenantId}:${email}`) ?? null;
  }

  async findById(id: UUID): Promise<AuthUser | null> {
    return this.byId.get(id) ?? null;
  }

  async listByTenant(tenantId: UUID, query: ListUsersQuery): Promise<PaginatedResult<AuthUser>> {
    let items = [...this.byId.values()].filter((u) => u.tenantId === tenantId);
    if (query.isActive !== undefined) {
      items = items.filter((u) => u.isActive === query.isActive);
    }
    if (query.search !== undefined && query.search !== '') {
      const term = query.search.toLowerCase();
      items = items.filter(
        (u) =>
          u.email.toLowerCase().includes(term) ||
          u.firstName.toLowerCase().includes(term) ||
          u.lastName.toLowerCase().includes(term),
      );
    }
    items.sort((a, b) => a.email.localeCompare(b.email));
    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    const start = (query.page - 1) * query.pageSize;
    return {
      items: items.slice(start, start + query.pageSize),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async create(user: AuthUser): Promise<AuthUser> {
    this.seed(user);
    return user;
  }

  async update(user: AuthUser): Promise<AuthUser> {
    this.seed(user);
    return user;
  }
}

class InMemoryRoleRepository implements IRoleRepository {
  private readonly byId = new Map<UUID, Role>();

  seed(role: Role): void {
    this.byId.set(role.id, role);
  }

  async findById(id: UUID): Promise<Role | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTenant(tenantId: UUID): Promise<Role[]> {
    return [...this.byId.values()].filter((r) => r.tenantId === tenantId);
  }

  async findByName(tenantId: UUID, name: string): Promise<Role | null> {
    for (const role of this.byId.values()) {
      if (role.tenantId === tenantId && role.name === name) {
        return role;
      }
    }
    return null;
  }

  async create(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async update(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async addPermissions(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async replacePermissions(role: Role): Promise<Role> {
    // The use case mutates the aggregate in place before persisting, so the
    // stored reference already carries the replaced permission set.
    this.byId.set(role.id, role);
    return role;
  }
}

class InMemoryAuditLogRepository implements IAuditLogRepository {
  private readonly records: AuditLogRecord[] = [];

  seed(record: AuditLogRecord): void {
    this.records.push(record);
  }

  async findMany(tenantId: UUID, query: AuditLogQuery): Promise<PaginatedResult<AuditLogRecord>> {
    const filters = query.filters ?? {};
    let items = this.records.filter((r) => r.tenantId === tenantId);

    if (filters.entityType !== undefined) {
      items = items.filter((r) => r.entityType === filters.entityType);
    }
    if (filters.entityId !== undefined) {
      items = items.filter((r) => r.entityId === filters.entityId);
    }
    if (filters.userId !== undefined) {
      items = items.filter((r) => r.userId === filters.userId);
    }
    if (filters.action !== undefined) {
      items = items.filter((r) => r.action === filters.action);
    }
    if (filters.from !== undefined) {
      const from = filters.from;
      items = items.filter((r) => r.timestamp.getTime() >= from.getTime());
    }
    if (filters.to !== undefined) {
      const to = filters.to;
      items = items.filter((r) => r.timestamp.getTime() <= to.getTime());
    }

    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    const start = (query.page - 1) * query.pageSize;
    return {
      items: items.slice(start, start + query.pageSize),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
    };
  }
}

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

interface TestAppOptions {
  /** When `false`, the caller is a Manager (no `administration` permission). */
  admin?: boolean;
}

interface TestApp {
  app: FastifyInstance;
  token: string;
  users: InMemoryUserRepository;
  roles: InMemoryRoleRepository;
  auditLogs: InMemoryAuditLogRepository;
}

async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const admin = options.admin ?? true;

  const tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

  const roles = new InMemoryRoleRepository();
  // Admin role: full wildcard grant (holds `administration`).
  roles.seed(
    Role.create(
      { tenantId: TENANT_ID, name: 'Admin', permissions: [Permission.create('*', '*', '*')] },
      ADMIN_ROLE_ID,
    ),
  );
  // Manager role: broad business access but NO administration permission.
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Manager',
        permissions: [Permission.create('sales', '*', 'write')],
      },
      MANAGER_ROLE_ID,
    ),
  );
  // A protected system role and a mutable custom role for the update tests.
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'User',
        isSystem: true,
        permissions: [Permission.create('sales', 'list', 'read')],
      },
      SYSTEM_ROLE_ID,
    ),
  );
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Cashier',
        permissions: [Permission.create('cash', 'list', 'read')],
      },
      CUSTOM_ROLE_ID,
    ),
  );

  const callerRoleId = admin ? ADMIN_ROLE_ID : MANAGER_ROLE_ID;
  const adminUser = AuthUser.reconstitute(ADMIN_USER_ID, {
    tenantId: TENANT_ID,
    email: 'admin@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'Admin',
    roleId: callerRoleId,
    phone: null,
    avatar: null,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  });
  const token = await tokenService.issueAccessToken(adminUser);

  const users = new InMemoryUserRepository();
  users.seed(adminUser);
  // A second, existing user in the tenant for the assign-role tests.
  users.seed(
    AuthUser.reconstitute(EXISTING_USER_ID, {
      tenantId: TENANT_ID,
      email: 'grace@example.com',
      passwordHash: 'hash',
      firstName: 'Grace',
      lastName: 'Hopper',
      roleId: MANAGER_ROLE_ID,
      phone: null,
      avatar: null,
      isActive: true,
      lastLoginAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    }),
  );

  const auditLogs = new InMemoryAuditLogRepository();

  const container = new Container();
  container.registerValue(AUTH_TOKENS.UserRepository, users);
  container.registerValue(AUTHORIZATION_TOKENS.RoleRepository, roles);
  container.registerValue(ADMINISTRATION_TOKENS.AuditLogRepository, auditLogs);

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  await registerAdminRoutes(app, container);
  await app.ready();

  return { app, token, users, roles, auditLogs };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function auditRecord(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    id: overrides.id ?? 'a0000000-0000-0000-0000-000000000001',
    tenantId: overrides.tenantId ?? TENANT_ID,
    userId: overrides.userId ?? ADMIN_USER_ID,
    entityType: overrides.entityType ?? 'Sale',
    entityId: overrides.entityId ?? 's0000000-0000-0000-0000-000000000001',
    action: overrides.action ?? 'CREATE',
    oldValues: overrides.oldValues ?? null,
    newValues: overrides.newValues ?? null,
    ipAddress: overrides.ipAddress ?? null,
    userAgent: overrides.userAgent ?? null,
    timestamp: overrides.timestamp ?? new Date('2024-01-15T10:00:00.000Z'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/audit-logs' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when a non-admin role calls an admin endpoint', async () => {
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: authHeader(ctx.token),
        payload: {
          email: 'new@example.com',
          password: 'Password123',
          firstName: 'New',
          lastName: 'User',
          roleId: MANAGER_ROLE_ID,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/v1/admin/users', () => {
    it('creates a user in the caller tenant and returns 201 (no password hash)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: authHeader(ctx.token),
        payload: {
          email: 'katherine@example.com',
          password: 'Password123',
          firstName: 'Katherine',
          lastName: 'Johnson',
          roleId: MANAGER_ROLE_ID,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        tenantId: TENANT_ID,
        email: 'katherine@example.com',
        firstName: 'Katherine',
        roleId: MANAGER_ROLE_ID,
        isActive: true,
      });
      expect(body.passwordHash).toBeUndefined();
    });

    it('derives the tenant from the token, ignoring any client-supplied tenantId', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: authHeader(ctx.token),
        payload: {
          tenantId: OTHER_TENANT_ID,
          email: 'dorothy@example.com',
          password: 'Password123',
          firstName: 'Dorothy',
          lastName: 'Vaughan',
          roleId: MANAGER_ROLE_ID,
        },
      });
      // `.strict()` rejects the unknown `tenantId` field with a 400.
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 409 on a duplicate email within the tenant', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: authHeader(ctx.token),
        payload: {
          email: 'grace@example.com',
          password: 'Password123',
          firstName: 'Grace',
          lastName: 'Hopper',
          roleId: MANAGER_ROLE_ID,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 400 when required fields are missing/invalid', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: authHeader(ctx.token),
        payload: { email: 'not-an-email', password: 'short' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/v1/admin/users/:id/role', () => {
    it('assigns a role to a user and returns 200', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/users/${EXISTING_USER_ID}/role`,
        headers: authHeader(ctx.token),
        payload: { roleId: CUSTOM_ROLE_ID },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: EXISTING_USER_ID, roleId: CUSTOM_ROLE_ID });
    });

    it('returns 404 when the user does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/users/${MISSING_ID}/role`,
        headers: authHeader(ctx.token),
        payload: { roleId: CUSTOM_ROLE_ID },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 when the role does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/users/${EXISTING_USER_ID}/role`,
        headers: authHeader(ctx.token),
        payload: { roleId: MISSING_ID },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/admin/roles', () => {
    it('creates a custom role with initial permissions and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/roles',
        headers: authHeader(ctx.token),
        payload: {
          name: 'Auditor',
          description: 'Read-only audit access',
          permissions: [{ module: 'administration', screen: 'audit', action: 'read' }],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({ tenantId: TENANT_ID, name: 'Auditor', isSystem: false });
      expect(body.permissions).toEqual([
        { module: 'administration', screen: 'audit', action: 'read' },
      ]);
    });

    it('returns 409 when a role with the same name already exists', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/roles',
        headers: authHeader(ctx.token),
        payload: { name: 'Cashier' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 400 when the name is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/admin/roles',
        headers: authHeader(ctx.token),
        payload: { description: 'no name' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/v1/admin/roles/:id/permissions', () => {
    it('replaces a custom role permission set and returns 200', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/roles/${CUSTOM_ROLE_ID}/permissions`,
        headers: authHeader(ctx.token),
        payload: {
          permissions: [
            { module: 'cash', screen: 'list', action: 'read' },
            { module: 'cash', screen: 'register', action: 'write' },
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(CUSTOM_ROLE_ID);
      expect(body.permissions).toEqual([
        { module: 'cash', screen: 'list', action: 'read' },
        { module: 'cash', screen: 'register', action: 'write' },
      ]);
    });

    it('returns 422 when attempting to modify a system role', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/roles/${SYSTEM_ROLE_ID}/permissions`,
        headers: authHeader(ctx.token),
        payload: { permissions: [{ module: 'sales', screen: 'list', action: 'write' }] },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 404 when the role does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/roles/${MISSING_ID}/permissions`,
        headers: authHeader(ctx.token),
        payload: { permissions: [] },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/admin/audit-logs', () => {
    it('lists audit logs scoped to the tenant', async () => {
      ctx = await buildTestApp();
      ctx.auditLogs.seed(auditRecord({ id: 'a0000000-0000-0000-0000-000000000001' }));
      ctx.auditLogs.seed(
        auditRecord({ id: 'a0000000-0000-0000-0000-000000000002', tenantId: OTHER_TENANT_ID }),
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
      expect(body.items).toHaveLength(1);
    });

    it('filters audit logs by entityType and action', async () => {
      ctx = await buildTestApp();
      ctx.auditLogs.seed(
        auditRecord({ id: 'a0000000-0000-0000-0000-000000000003', entityType: 'Sale', action: 'CREATE' }),
      );
      ctx.auditLogs.seed(
        auditRecord({
          id: 'a0000000-0000-0000-0000-000000000004',
          entityType: 'Product',
          action: 'UPDATE',
        }),
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs?entityType=Product&action=UPDATE',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ entityType: 'Product', action: 'UPDATE' });
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs?page=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/admin/users', () => {
    it('lists the tenant users (paginated, no password hash)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/users?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      // The seeded admin + the existing "grace" user, both in TENANT_ID.
      expect(body).toMatchObject({ total: 2, page: 1, pageSize: 10 });
      expect(body.items).toHaveLength(2);
      expect(body.items[0].passwordHash).toBeUndefined();
      expect(body.items.every((u: { tenantId: string }) => u.tenantId === TENANT_ID)).toBe(true);
    });

    it('filters users by a case-insensitive search term', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/users?search=GRACE',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ email: 'grace@example.com' });
    });

    it('returns 403 for a non-admin caller', async () => {
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/users',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/users?pageSize=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/admin/roles', () => {
    it('lists the tenant roles with their permissions', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/roles',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      const names = (body as Array<{ name: string }>).map((r) => r.name).sort();
      expect(names).toEqual(['Admin', 'Cashier', 'Manager', 'User']);
    });

    it('returns 403 for a non-admin caller', async () => {
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/roles',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/v1/admin/roles/:id', () => {
    it('reads a single role with its permission set', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/admin/roles/${CUSTOM_ROLE_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ id: CUSTOM_ROLE_ID, name: 'Cashier' });
      expect(body.permissions).toEqual([{ module: 'cash', screen: 'list', action: 'read' }]);
    });

    it('returns 404 when the role does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/admin/roles/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 403 for a non-admin caller', async () => {
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/admin/roles/${CUSTOM_ROLE_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });
  });
});
