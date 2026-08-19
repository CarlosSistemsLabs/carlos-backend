import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, SUPPLIER_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import { registerFeatureFlagAuthorization } from '@presentation/middlewares/feature-flag.js';
import { JwtTokenService } from '../../auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../auth/domain/entities/auth-user.js';
import { Role } from '../../authorization/domain/entities/role.js';
import { Permission } from '../../authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../authorization/domain/repositories/role-repository.js';
import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../../subscriptions/domain/services/feature-access-service.js';
import { Supplier } from '../domain/entities/supplier.js';
import type {
  SupplierQuery,
  ISupplierRepository,
} from '../domain/repositories/supplier-repository.js';
import { CreateSupplierUseCase } from '../application/use-cases/create-supplier.use-case.js';
import { UpdateSupplierUseCase } from '../application/use-cases/update-supplier.use-case.js';
import { DeleteSupplierUseCase } from '../application/use-cases/delete-supplier.use-case.js';
import { GetSupplierUseCase } from '../application/use-cases/get-supplier.use-case.js';
import { ListSuppliersUseCase } from '../application/use-cases/list-suppliers.use-case.js';
import { SearchSuppliersUseCase } from '../application/use-cases/search-suppliers.use-case.js';
import { registerSupplierRoutes } from './supplier.routes.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemorySupplierRepository implements ISupplierRepository {
  private readonly byId = new Map<UUID, Supplier>();

  seed(supplier: Supplier): void {
    this.byId.set(supplier.id, supplier);
  }

  async findById(id: UUID): Promise<Supplier | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(tenantId: UUID, email: string): Promise<Supplier | null> {
    for (const supplier of this.byId.values()) {
      if (supplier.tenantId === tenantId && supplier.email?.value === email) {
        return supplier;
      }
    }
    return null;
  }

  async findByPhone(tenantId: UUID, phone: string): Promise<Supplier | null> {
    for (const supplier of this.byId.values()) {
      if (supplier.tenantId === tenantId && supplier.phone?.value === phone) {
        return supplier;
      }
    }
    return null;
  }

  async findMany(tenantId: UUID, query: SupplierQuery): Promise<PaginatedResult<Supplier>> {
    const filters = query.filters ?? {};
    let items = [...this.byId.values()].filter((s) => s.tenantId === tenantId);

    if (filters.isActive !== undefined) {
      items = items.filter((s) => s.isActive === filters.isActive);
    }
    if (filters.search !== undefined) {
      const term = filters.search.toLowerCase();
      items = items.filter((s) => {
        const haystacks = [
          s.name,
          s.email?.value ?? '',
          s.phone?.value ?? '',
          s.taxId?.value ?? '',
        ];
        return haystacks.some((value) => value.toLowerCase().includes(term));
      });
    }

    const sort = query.sort;
    if (sort !== undefined) {
      const direction = sort.direction === 'desc' ? -1 : 1;
      items = [...items].sort((a, b) => {
        const av = sort.field === 'email' ? (a.email?.value ?? '') : a.name;
        const bv = sort.field === 'email' ? (b.email?.value ?? '') : b.name;
        return av.localeCompare(bv) * direction;
      });
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

  async create(supplier: Supplier): Promise<Supplier> {
    this.byId.set(supplier.id, supplier);
    return supplier;
  }

  async update(supplier: Supplier): Promise<Supplier> {
    this.byId.set(supplier.id, supplier);
    return supplier;
  }

  async softDelete(id: UUID): Promise<void> {
    this.byId.delete(id);
  }

  async existsByEmail(tenantId: UUID, email: string, excludeId?: UUID): Promise<boolean> {
    for (const supplier of this.byId.values()) {
      if (
        supplier.tenantId === tenantId &&
        supplier.email?.value === email &&
        supplier.id !== excludeId
      ) {
        return true;
      }
    }
    return false;
  }

  async existsByPhone(tenantId: UUID, phone: string, excludeId?: UUID): Promise<boolean> {
    for (const supplier of this.byId.values()) {
      if (
        supplier.tenantId === tenantId &&
        supplier.phone?.value === phone &&
        supplier.id !== excludeId
      ) {
        return true;
      }
    }
    return false;
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
    this.byId.set(role.id, role);
    return role;
  }
}

class AllowAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: true };
  }

  async isFeatureEnabled(): Promise<boolean> {
    return true;
  }
}

class DenyAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: false, reason: 'plan_excludes_feature' };
  }

  async isFeatureEnabled(): Promise<boolean> {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

interface TestAppOptions {
  fullAccess?: boolean;
  featureAllowed?: boolean;
}

interface TestApp {
  app: FastifyInstance;
  token: string;
  suppliers: InMemorySupplierRepository;
}

async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const fullAccess = options.fullAccess ?? true;
  const featureAllowed = options.featureAllowed ?? true;

  const tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

  const roles = new InMemoryRoleRepository();
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Admin',
        permissions: [Permission.create('*', '*', '*')],
      },
      ADMIN_ROLE_ID,
    ),
  );
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Reader',
        permissions: [Permission.create('suppliers', '*', 'read')],
      },
      READER_ROLE_ID,
    ),
  );

  const roleId = fullAccess ? ADMIN_ROLE_ID : READER_ROLE_ID;
  const user = AuthUser.reconstitute(USER_ID, {
    tenantId: TENANT_ID,
    email: 'ada@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId,
    phone: null,
    avatar: null,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  });
  const token = await tokenService.issueAccessToken(user);

  const suppliers = new InMemorySupplierRepository();

  const container = new Container();
  container.registerValue(
    SUPPLIER_TOKENS.CreateSupplierUseCase,
    new CreateSupplierUseCase(suppliers),
  );
  container.registerValue(
    SUPPLIER_TOKENS.UpdateSupplierUseCase,
    new UpdateSupplierUseCase(suppliers),
  );
  container.registerValue(
    SUPPLIER_TOKENS.DeleteSupplierUseCase,
    new DeleteSupplierUseCase(suppliers),
  );
  container.registerValue(SUPPLIER_TOKENS.GetSupplierUseCase, new GetSupplierUseCase(suppliers));
  container.registerValue(
    SUPPLIER_TOKENS.ListSuppliersUseCase,
    new ListSuppliersUseCase(suppliers),
  );
  container.registerValue(
    SUPPLIER_TOKENS.SearchSuppliersUseCase,
    new SearchSuppliersUseCase(suppliers),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerSupplierRoutes(app, container);
  await app.ready();

  return { app, token, suppliers };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function seedSupplier(
  ctx: TestApp,
  overrides: Partial<{
    id: UUID;
    tenantId: UUID;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
  }> = {},
): Supplier {
  const supplier = Supplier.create(
    {
      tenantId: overrides.tenantId ?? TENANT_ID,
      name: overrides.name ?? 'Grace Supplies',
      email: overrides.email === undefined ? 'grace@example.com' : overrides.email,
      phone: overrides.phone === undefined ? '+541112345678' : overrides.phone,
      ...(overrides.isActive !== undefined ? { isActive: overrides.isActive } : {}),
    },
    overrides.id,
  );
  ctx.suppliers.seed(supplier);
  return supplier;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('supplier routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/suppliers' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the write permission (create as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/suppliers',
        headers: authHeader(ctx.token),
        payload: { name: 'New Supplier' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/suppliers',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/suppliers', () => {
    it('creates a supplier and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/suppliers',
        headers: authHeader(ctx.token),
        payload: { name: 'Alan Supplies', email: 'alan@example.com', phone: '+541133334444' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        tenantId: TENANT_ID,
        name: 'Alan Supplies',
        email: 'alan@example.com',
        isActive: true,
      });
      expect(body.id).toBeDefined();
    });

    it('returns 409 when the email already exists for the tenant', async () => {
      ctx = await buildTestApp();
      seedSupplier(ctx, { email: 'dup@example.com', phone: null });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/suppliers',
        headers: authHeader(ctx.token),
        payload: { name: 'Duplicate', email: 'dup@example.com' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 409 when the phone already exists for the tenant', async () => {
      ctx = await buildTestApp();
      seedSupplier(ctx, { email: null, phone: '+541155556666' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/suppliers',
        headers: authHeader(ctx.token),
        payload: { name: 'Duplicate', phone: '+541155556666' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 400 when the name is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/suppliers',
        headers: authHeader(ctx.token),
        payload: { email: 'noname@example.com' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when the email is malformed', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/suppliers',
        headers: authHeader(ctx.token),
        payload: { name: 'Bad Email', email: 'not-an-email' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/suppliers', () => {
    it('returns a paginated list of the tenant suppliers', async () => {
      ctx = await buildTestApp();
      seedSupplier(ctx, { id: '10000000-0000-0000-0000-000000000001', name: 'Aaa', email: 'a@example.com', phone: null });
      seedSupplier(ctx, { id: '10000000-0000-0000-0000-000000000002', name: 'Bbb', email: 'b@example.com', phone: null });
      // A supplier belonging to another tenant must not leak.
      seedSupplier(ctx, {
        id: '10000000-0000-0000-0000-000000000003',
        tenantId: OTHER_TENANT_ID,
        name: 'Ccc',
        email: 'c@example.com',
        phone: null,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/suppliers?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toMatchObject({ total: 2, page: 1, pageSize: 10 });
      expect(body.items).toHaveLength(2);
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/suppliers?page=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/suppliers/search', () => {
    it('is not shadowed by /:id and matches by term', async () => {
      ctx = await buildTestApp();
      seedSupplier(ctx, {
        id: '20000000-0000-0000-0000-000000000001',
        name: 'Katherine Supplies',
        email: 'katherine@example.com',
        phone: null,
      });
      seedSupplier(ctx, {
        id: '20000000-0000-0000-0000-000000000002',
        name: 'Dorothy Supplies',
        email: 'dorothy@example.com',
        phone: null,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/suppliers/search?q=katherine',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Katherine Supplies');
    });

    it('returns 400 when the search term is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/suppliers/search',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/suppliers/:id', () => {
    it('returns 200 with the supplier details', async () => {
      ctx = await buildTestApp();
      const seeded = seedSupplier(ctx, { id: '30000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/suppliers/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: seeded.id, name: 'Grace Supplies' });
    });

    it('returns 404 when the supplier does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/suppliers/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 for a supplier owned by another tenant', async () => {
      ctx = await buildTestApp();
      const seeded = seedSupplier(ctx, {
        id: '30000000-0000-0000-0000-000000000002',
        tenantId: OTHER_TENANT_ID,
        phone: null,
      });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/suppliers/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/suppliers/:id', () => {
    it('updates a supplier and returns 200', async () => {
      ctx = await buildTestApp();
      const seeded = seedSupplier(ctx, { id: '40000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/suppliers/${seeded.id}`,
        headers: authHeader(ctx.token),
        payload: { name: 'Grace M. Supplies' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Grace M. Supplies');
    });

    it('returns 404 when updating a missing supplier', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/suppliers/${MISSING_ID}`,
        headers: authHeader(ctx.token),
        payload: { name: 'Nobody' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 409 when updating to a conflicting email', async () => {
      ctx = await buildTestApp();
      seedSupplier(ctx, {
        id: '40000000-0000-0000-0000-000000000002',
        email: 'taken@example.com',
        phone: null,
      });
      const target = seedSupplier(ctx, {
        id: '40000000-0000-0000-0000-000000000003',
        email: 'target@example.com',
        phone: null,
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/suppliers/${target.id}`,
        headers: authHeader(ctx.token),
        payload: { email: 'taken@example.com' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 400 on an invalid body', async () => {
      ctx = await buildTestApp();
      const seeded = seedSupplier(ctx, { id: '40000000-0000-0000-0000-000000000004' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/suppliers/${seeded.id}`,
        headers: authHeader(ctx.token),
        payload: { email: 'not-an-email' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/suppliers/:id', () => {
    it('soft-deletes a supplier and returns 204', async () => {
      ctx = await buildTestApp();
      const seeded = seedSupplier(ctx, { id: '50000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/suppliers/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(204);
      expect(await ctx.suppliers.findById(seeded.id)).toBeNull();
    });

    it('returns 404 when deleting a missing supplier', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/suppliers/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });
});
