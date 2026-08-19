import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, CUSTOMER_TOKENS } from '@infrastructure/di/index.js';
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
import { Customer } from '../domain/entities/customer.js';
import type {
  CustomerQuery,
  ICustomerRepository,
} from '../domain/repositories/customer-repository.js';
import { CreateCustomerUseCase } from '../application/use-cases/create-customer.use-case.js';
import { UpdateCustomerUseCase } from '../application/use-cases/update-customer.use-case.js';
import { DeleteCustomerUseCase } from '../application/use-cases/delete-customer.use-case.js';
import { GetCustomerUseCase } from '../application/use-cases/get-customer.use-case.js';
import { ListCustomersUseCase } from '../application/use-cases/list-customers.use-case.js';
import { SearchCustomersUseCase } from '../application/use-cases/search-customers.use-case.js';
import { registerCustomerRoutes } from './customer.routes.js';
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

class InMemoryCustomerRepository implements ICustomerRepository {
  private readonly byId = new Map<UUID, Customer>();

  seed(customer: Customer): void {
    this.byId.set(customer.id, customer);
  }

  async findById(id: UUID): Promise<Customer | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(tenantId: UUID, email: string): Promise<Customer | null> {
    for (const customer of this.byId.values()) {
      if (customer.tenantId === tenantId && customer.email?.value === email) {
        return customer;
      }
    }
    return null;
  }

  async findByPhone(tenantId: UUID, phone: string): Promise<Customer | null> {
    for (const customer of this.byId.values()) {
      if (customer.tenantId === tenantId && customer.phone?.value === phone) {
        return customer;
      }
    }
    return null;
  }

  async findMany(tenantId: UUID, query: CustomerQuery): Promise<PaginatedResult<Customer>> {
    const filters = query.filters ?? {};
    let items = [...this.byId.values()].filter((c) => c.tenantId === tenantId);

    if (filters.isActive !== undefined) {
      items = items.filter((c) => c.isActive === filters.isActive);
    }
    if (filters.search !== undefined) {
      const term = filters.search.toLowerCase();
      items = items.filter((c) => {
        const haystacks = [
          c.name,
          c.email?.value ?? '',
          c.phone?.value ?? '',
          c.taxId?.value ?? '',
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

  async create(customer: Customer): Promise<Customer> {
    this.byId.set(customer.id, customer);
    return customer;
  }

  async update(customer: Customer): Promise<Customer> {
    this.byId.set(customer.id, customer);
    return customer;
  }

  async softDelete(id: UUID): Promise<void> {
    this.byId.delete(id);
  }

  async existsByEmail(tenantId: UUID, email: string, excludeId?: UUID): Promise<boolean> {
    for (const customer of this.byId.values()) {
      if (
        customer.tenantId === tenantId &&
        customer.email?.value === email &&
        customer.id !== excludeId
      ) {
        return true;
      }
    }
    return false;
  }

  async existsByPhone(tenantId: UUID, phone: string, excludeId?: UUID): Promise<boolean> {
    for (const customer of this.byId.values()) {
      if (
        customer.tenantId === tenantId &&
        customer.phone?.value === phone &&
        customer.id !== excludeId
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
  customers: InMemoryCustomerRepository;
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
        permissions: [Permission.create('customers', '*', 'read')],
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

  const customers = new InMemoryCustomerRepository();

  const container = new Container();
  container.registerValue(
    CUSTOMER_TOKENS.CreateCustomerUseCase,
    new CreateCustomerUseCase(customers),
  );
  container.registerValue(
    CUSTOMER_TOKENS.UpdateCustomerUseCase,
    new UpdateCustomerUseCase(customers),
  );
  container.registerValue(
    CUSTOMER_TOKENS.DeleteCustomerUseCase,
    new DeleteCustomerUseCase(customers),
  );
  container.registerValue(CUSTOMER_TOKENS.GetCustomerUseCase, new GetCustomerUseCase(customers));
  container.registerValue(
    CUSTOMER_TOKENS.ListCustomersUseCase,
    new ListCustomersUseCase(customers),
  );
  container.registerValue(
    CUSTOMER_TOKENS.SearchCustomersUseCase,
    new SearchCustomersUseCase(customers),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerCustomerRoutes(app, container);
  await app.ready();

  return { app, token, customers };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function seedCustomer(
  ctx: TestApp,
  overrides: Partial<{
    id: UUID;
    tenantId: UUID;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
  }> = {},
): Customer {
  const customer = Customer.create(
    {
      tenantId: overrides.tenantId ?? TENANT_ID,
      name: overrides.name ?? 'Grace Hopper',
      email: overrides.email === undefined ? 'grace@example.com' : overrides.email,
      phone: overrides.phone === undefined ? '+541112345678' : overrides.phone,
      ...(overrides.isActive !== undefined ? { isActive: overrides.isActive } : {}),
    },
    overrides.id,
  );
  ctx.customers.seed(customer);
  return customer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('customer routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/customers' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the write permission (create as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: authHeader(ctx.token),
        payload: { name: 'New Customer' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/customers',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/customers', () => {
    it('creates a customer and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: authHeader(ctx.token),
        payload: { name: 'Alan Turing', email: 'alan@example.com', phone: '+541133334444' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        tenantId: TENANT_ID,
        name: 'Alan Turing',
        email: 'alan@example.com',
        isActive: true,
      });
      expect(body.id).toBeDefined();
    });

    it('returns 409 when the email already exists for the tenant', async () => {
      ctx = await buildTestApp();
      seedCustomer(ctx, { email: 'dup@example.com', phone: null });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: authHeader(ctx.token),
        payload: { name: 'Duplicate', email: 'dup@example.com' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 409 when the phone already exists for the tenant', async () => {
      ctx = await buildTestApp();
      seedCustomer(ctx, { email: null, phone: '+541155556666' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/customers',
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
        url: '/api/v1/customers',
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
        url: '/api/v1/customers',
        headers: authHeader(ctx.token),
        payload: { name: 'Bad Email', email: 'not-an-email' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/customers', () => {
    it('returns a paginated list of the tenant customers', async () => {
      ctx = await buildTestApp();
      seedCustomer(ctx, { id: '10000000-0000-0000-0000-000000000001', name: 'Aaa', email: 'a@example.com', phone: null });
      seedCustomer(ctx, { id: '10000000-0000-0000-0000-000000000002', name: 'Bbb', email: 'b@example.com', phone: null });
      // A customer belonging to another tenant must not leak.
      seedCustomer(ctx, {
        id: '10000000-0000-0000-0000-000000000003',
        tenantId: OTHER_TENANT_ID,
        name: 'Ccc',
        email: 'c@example.com',
        phone: null,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/customers?page=1&pageSize=10',
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
        url: '/api/v1/customers?page=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/customers/search', () => {
    it('is not shadowed by /:id and matches by term', async () => {
      ctx = await buildTestApp();
      seedCustomer(ctx, {
        id: '20000000-0000-0000-0000-000000000001',
        name: 'Katherine Johnson',
        email: 'katherine@example.com',
        phone: null,
      });
      seedCustomer(ctx, {
        id: '20000000-0000-0000-0000-000000000002',
        name: 'Dorothy Vaughan',
        email: 'dorothy@example.com',
        phone: null,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/customers/search?q=katherine',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Katherine Johnson');
    });

    it('returns 400 when the search term is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/customers/search',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('returns 200 with the customer details', async () => {
      ctx = await buildTestApp();
      const seeded = seedCustomer(ctx, { id: '30000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/customers/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: seeded.id, name: 'Grace Hopper' });
    });

    it('returns 404 when the customer does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/customers/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 for a customer owned by another tenant', async () => {
      ctx = await buildTestApp();
      const seeded = seedCustomer(ctx, {
        id: '30000000-0000-0000-0000-000000000002',
        tenantId: OTHER_TENANT_ID,
        phone: null,
      });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/customers/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/customers/:id', () => {
    it('updates a customer and returns 200', async () => {
      ctx = await buildTestApp();
      const seeded = seedCustomer(ctx, { id: '40000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/customers/${seeded.id}`,
        headers: authHeader(ctx.token),
        payload: { name: 'Grace M. Hopper' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Grace M. Hopper');
    });

    it('returns 404 when updating a missing customer', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/customers/${MISSING_ID}`,
        headers: authHeader(ctx.token),
        payload: { name: 'Nobody' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 409 when updating to a conflicting email', async () => {
      ctx = await buildTestApp();
      seedCustomer(ctx, {
        id: '40000000-0000-0000-0000-000000000002',
        email: 'taken@example.com',
        phone: null,
      });
      const target = seedCustomer(ctx, {
        id: '40000000-0000-0000-0000-000000000003',
        email: 'target@example.com',
        phone: null,
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/customers/${target.id}`,
        headers: authHeader(ctx.token),
        payload: { email: 'taken@example.com' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 400 on an invalid body', async () => {
      ctx = await buildTestApp();
      const seeded = seedCustomer(ctx, { id: '40000000-0000-0000-0000-000000000004' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/customers/${seeded.id}`,
        headers: authHeader(ctx.token),
        payload: { email: 'not-an-email' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/customers/:id', () => {
    it('soft-deletes a customer and returns 204', async () => {
      ctx = await buildTestApp();
      const seeded = seedCustomer(ctx, { id: '50000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/customers/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(204);
      expect(await ctx.customers.findById(seeded.id)).toBeNull();
    });

    it('returns 404 when deleting a missing customer', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/customers/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });
});
