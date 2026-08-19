import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, ADMINISTRATION_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { StubStorageService } from '@infrastructure/storage/stub-storage-service.js';
import type { UUID } from '@shared/types/index.js';
import { JwtTokenService } from '../../auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../auth/domain/entities/auth-user.js';
import { Role } from '../../authorization/domain/entities/role.js';
import { Permission } from '../../authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../authorization/domain/repositories/role-repository.js';
import { Tenant } from '../domain/entities/tenant.js';
import type { ITenantRepository } from '../domain/repositories/tenant-repository.js';
import { GetBrandingUseCase } from '../application/use-cases/get-branding.use-case.js';
import { UpdateBrandingUseCase } from '../application/use-cases/update-branding.use-case.js';
import { registerBrandingRoutes } from './branding.routes.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const MANAGER_ROLE_ID = '44444444-4444-4444-4444-444444444444';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

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
      if (role.tenantId === tenantId && role.name === name) return role;
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
    this.byId.set(role.id, role);
    return role;
  }
}

class InMemoryTenantRepository implements ITenantRepository {
  private readonly byId = new Map<UUID, Tenant>();
  seed(tenant: Tenant): void {
    this.byId.set(tenant.id, tenant);
  }
  async findById(id: UUID): Promise<Tenant | null> {
    return this.byId.get(id) ?? null;
  }
  async findBySlug(): Promise<Tenant | null> {
    return null;
  }
  async create(tenant: Tenant): Promise<Tenant> {
    this.byId.set(tenant.id, tenant);
    return tenant;
  }
  async update(tenant: Tenant): Promise<Tenant> {
    this.byId.set(tenant.id, tenant);
    return tenant;
  }
  async softDelete(id: UUID): Promise<void> {
    this.byId.delete(id);
  }
}

interface TestApp {
  app: FastifyInstance;
  token: string;
  tenants: InMemoryTenantRepository;
  storage: StubStorageService;
}

async function buildTestApp(options: { admin?: boolean } = {}): Promise<TestApp> {
  const admin = options.admin ?? true;
  const tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

  const roles = new InMemoryRoleRepository();
  roles.seed(
    Role.create(
      { tenantId: TENANT_ID, name: 'Admin', permissions: [Permission.create('*', '*', '*')] },
      ADMIN_ROLE_ID,
    ),
  );
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

  const tenants = new InMemoryTenantRepository();
  tenants.seed(
    Tenant.create(
      { name: 'Acme', slug: 'acme', theme: 'light', primaryColor: '#112233' },
      TENANT_ID,
    ),
  );

  const cache = new InMemoryCache();
  const storage = new StubStorageService();

  const container = new Container();
  container.registerValue(
    ADMINISTRATION_TOKENS.GetBrandingUseCase,
    new GetBrandingUseCase(tenants, cache),
  );
  container.registerValue(
    ADMINISTRATION_TOKENS.UpdateBrandingUseCase,
    new UpdateBrandingUseCase(tenants, storage, cache),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  await registerBrandingRoutes(app, container);
  await app.ready();

  return { app, token, tenants, storage };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('branding routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('GET /api/v1/branding', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/branding' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns the caller tenant branding for any authenticated user (200)', async () => {
      // A non-admin (Manager) can still READ branding.
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/branding',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'Acme',
        theme: 'light',
        primaryColor: '#112233',
      });
      expect(response.headers['cache-control']).toContain('max-age=30');
    });
  });

  describe('PUT /api/v1/branding', () => {
    it('updates branding as an admin and returns 200', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/branding',
        headers: authHeader(ctx.token),
        payload: { name: 'Acme LLC', theme: 'dark', secondaryColor: '#abc' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'Acme LLC',
        theme: 'dark',
        secondaryColor: '#aabbcc',
      });
    });

    it('uploads a base64 logo and stores the returned URL (200)', async () => {
      ctx = await buildTestApp();
      const data = Buffer.alloc(32, 9).toString('base64');
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/branding',
        headers: authHeader(ctx.token),
        payload: { logoFile: { data, contentType: 'image/png', filename: 'logo.png' } },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().logo).toContain(`/uploads/tenants/${TENANT_ID}/branding/`);
      expect(ctx.storage.storedCount).toBe(1);
    });

    it('returns 403 for a non-admin caller', async () => {
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/branding',
        headers: authHeader(ctx.token),
        payload: { name: 'Nope' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 400 for a malformed color', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/branding',
        headers: authHeader(ctx.token),
        payload: { primaryColor: 'not-a-color' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for an invalid logo content type', async () => {
      ctx = await buildTestApp();
      const data = Buffer.alloc(8, 1).toString('base64');
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/branding',
        headers: authHeader(ctx.token),
        payload: { logoFile: { data, contentType: 'application/pdf' } },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unknown field with 400 (strict body)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/branding',
        headers: authHeader(ctx.token),
        payload: { tenantId: TENANT_ID, name: 'X' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });
});
