import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, SALES_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import { registerFeatureFlagAuthorization } from '@presentation/middlewares/feature-flag.js';
import { InMemoryEventBus } from '@infrastructure/events/in-memory-event-bus.js';
import { Money } from '@shared/value-objects/money.js';
import type { DomainEvent } from '@domain/events/index.js';
import { JwtTokenService } from '../../auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../auth/domain/entities/auth-user.js';
import { Role } from '../../authorization/domain/entities/role.js';
import { Permission } from '../../authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../authorization/domain/repositories/role-repository.js';
import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../../subscriptions/domain/services/feature-access-service.js';
import { Sale } from '../domain/entities/sale.js';
import { SaleDetail } from '../domain/entities/sale-detail.js';
import type { SaleQuery, ISaleRepository } from '../domain/repositories/sale-repository.js';
import type {
  ISaleUnitOfWork,
  SaleTransactionContext,
} from '../domain/repositories/sale-unit-of-work.js';
import type { ISaleProductReader, ProductPricing } from '../domain/ports/sale-product-reader.js';
import type { ISaleCustomerReader } from '../domain/ports/sale-customer-reader.js';
import type { SaleStatus } from '../domain/value-objects/sale-status.js';
import { CreateSaleUseCase } from '../application/use-cases/create-sale.use-case.js';
import { GetSaleUseCase } from '../application/use-cases/get-sale.use-case.js';
import { ListSalesUseCase } from '../application/use-cases/list-sales.use-case.js';
import { UpdateSaleStatusUseCase } from '../application/use-cases/update-sale-status.use-case.js';
import { DeleteSaleUseCase } from '../application/use-cases/delete-sale.use-case.js';
import { registerSaleRoutes } from './sale.routes.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const CUSTOMER_ID = '55555555-5555-5555-5555-555555555555';
const BRANCH_ID = '66666666-6666-6666-6666-666666666666';
const PRODUCT_A = '77777777-7777-7777-7777-777777777777';
const PRODUCT_B = '88888888-8888-8888-8888-888888888888';
const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CURRENCY = 'ARS';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemorySaleRepository implements ISaleRepository {
  private readonly byId = new Map<UUID, Sale>();
  private sequence = 0;

  seed(sale: Sale): void {
    this.byId.set(sale.id, sale);
  }

  async findById(id: UUID): Promise<Sale | null> {
    return this.byId.get(id) ?? null;
  }

  async findMany(tenantId: UUID, query: SaleQuery): Promise<PaginatedResult<Sale>> {
    const filters = query.filters ?? {};
    let items = [...this.byId.values()].filter((s) => s.tenantId === tenantId);

    if (filters.customerId !== undefined) {
      items = items.filter((s) => s.customerId === filters.customerId);
    }
    if (filters.branchId !== undefined) {
      items = items.filter((s) => s.branchId === filters.branchId);
    }
    if (filters.status !== undefined) {
      items = items.filter((s) => s.status === filters.status);
    }
    if (filters.from !== undefined) {
      const from = filters.from;
      items = items.filter((s) => s.saleDate.getTime() >= from.getTime());
    }
    if (filters.to !== undefined) {
      const to = filters.to;
      items = items.filter((s) => s.saleDate.getTime() <= to.getTime());
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

  async create(sale: Sale): Promise<Sale> {
    this.byId.set(sale.id, sale);
    return sale;
  }

  async updateStatus(id: UUID, _status: SaleStatus): Promise<void> {
    // The use case mutates the loaded aggregate in place before calling this,
    // so the stored reference already carries the new status; nothing else to
    // persist for the in-memory fake beyond confirming the row exists.
    if (!this.byId.has(id)) {
      throw new Error(`Sale ${id} not found`);
    }
  }

  async softDelete(id: UUID): Promise<void> {
    this.byId.delete(id);
  }

  async nextSaleNumber(_tenantId: UUID): Promise<string> {
    this.sequence += 1;
    return `SALE-${String(this.sequence).padStart(6, '0')}`;
  }
}

class InMemorySaleUnitOfWork implements ISaleUnitOfWork {
  constructor(private readonly sales: ISaleRepository) {}

  execute<T>(work: (ctx: SaleTransactionContext) => Promise<T>): Promise<T> {
    return work({ sales: this.sales });
  }
}

class FakeProductReader implements ISaleProductReader {
  async findPricing(_tenantId: UUID, productId: UUID): Promise<ProductPricing | null> {
    if (productId === PRODUCT_A) {
      return { productId, unitPrice: Money.fromDecimal('100.00', CURRENCY), taxRate: 21 };
    }
    if (productId === PRODUCT_B) {
      return { productId, unitPrice: Money.fromDecimal('50.00', CURRENCY), taxRate: 0 };
    }
    return null;
  }
}

class FakeCustomerReader implements ISaleCustomerReader {
  async exists(_tenantId: UUID, customerId: UUID): Promise<boolean> {
    return customerId === CUSTOMER_ID;
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
  sales: InMemorySaleRepository;
  publishedEvents: DomainEvent[];
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
        permissions: [Permission.create('sales', '*', 'read')],
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

  const sales = new InMemorySaleRepository();
  const publishedEvents: DomainEvent[] = [];
  const bus = new InMemoryEventBus((error) => {
    throw error instanceof Error ? error : new Error(String(error));
  });
  // Capture every published event across all names for assertions.
  const originalPublish = bus.publish.bind(bus);
  vi.spyOn(bus, 'publish').mockImplementation(async (event: DomainEvent) => {
    publishedEvents.push(event);
    await originalPublish(event);
  });

  const products = new FakeProductReader();
  const customers = new FakeCustomerReader();
  const unitOfWork = new InMemorySaleUnitOfWork(sales);

  const container = new Container();
  container.registerValue(
    SALES_TOKENS.CreateSaleUseCase,
    new CreateSaleUseCase(unitOfWork, products, customers, bus),
  );
  container.registerValue(SALES_TOKENS.GetSaleUseCase, new GetSaleUseCase(sales));
  container.registerValue(SALES_TOKENS.ListSalesUseCase, new ListSalesUseCase(sales));
  container.registerValue(
    SALES_TOKENS.UpdateSaleStatusUseCase,
    new UpdateSaleStatusUseCase(sales, bus),
  );
  container.registerValue(SALES_TOKENS.DeleteSaleUseCase, new DeleteSaleUseCase(sales));

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerSaleRoutes(app, container);
  await app.ready();

  return { app, token, sales, publishedEvents };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

interface SeedSaleOverrides {
  id?: UUID;
  tenantId?: UUID;
  customerId?: UUID;
  branchId?: UUID | null;
  status?: SaleStatus;
  saleNumber?: string;
  saleDate?: Date;
}

/** Seeds a sale (one line item) directly into the repository. */
function seedSale(ctx: TestApp, overrides: SeedSaleOverrides = {}): Sale {
  const line = SaleDetail.create({
    productId: PRODUCT_A,
    quantity: 2,
    unitPrice: Money.fromDecimal('100.00', CURRENCY),
    taxRate: 21,
  });
  const sale = Sale.create(
    {
      tenantId: overrides.tenantId ?? TENANT_ID,
      customerId: overrides.customerId ?? CUSTOMER_ID,
      userId: USER_ID,
      saleNumber: overrides.saleNumber ?? 'SALE-000100',
      currency: CURRENCY,
      branchId: overrides.branchId ?? BRANCH_ID,
      items: [line],
      ...(overrides.saleDate !== undefined ? { saleDate: overrides.saleDate } : {}),
    },
    overrides.id,
  );
  const status = overrides.status ?? 'completed';
  if (status === 'completed') {
    sale.complete();
    sale.pullDomainEvents(); // discard the seed-time SaleCompleted event
  } else if (status === 'cancelled') {
    sale.cancel();
  }
  ctx.sales.seed(sale);
  return sale;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sale routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/sales' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the write permission (create as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: { customerId: CUSTOMER_ID, items: [{ productId: PRODUCT_A, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/sales', () => {
    it('creates a sale with authoritative pricing and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: {
          customerId: CUSTOMER_ID,
          branchId: BRANCH_ID,
          items: [
            { productId: PRODUCT_A, quantity: 2 },
            { productId: PRODUCT_B, quantity: 3 },
          ],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        userId: USER_ID,
        status: 'completed',
        currency: CURRENCY,
      });
      // 2*100 + 3*50 = 350 subtotal; tax = 2*100*0.21 = 42; total = 392.
      expect(body.subtotal).toBe('350.00');
      expect(body.taxAmount).toBe('42.00');
      expect(body.total).toBe('392.00');
      expect(body.items).toHaveLength(2);
      // Client sent no prices; the reader is authoritative.
      expect(body.items[0]).toMatchObject({ productId: PRODUCT_A, unitPrice: '100.00' });
      // A completed sale publishes SaleCompleted.
      expect(ctx.publishedEvents.map((e) => e.eventName())).toContain('SaleCompleted');
    });

    it('creates a draft sale without publishing SaleCompleted', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: {
          customerId: CUSTOMER_ID,
          items: [{ productId: PRODUCT_A, quantity: 1 }],
          status: 'draft',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('draft');
      expect(ctx.publishedEvents).toHaveLength(0);
    });

    it('returns 404 when the customer does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: { customerId: MISSING_ID, items: [{ productId: PRODUCT_A, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 when a product does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: { customerId: CUSTOMER_ID, items: [{ productId: MISSING_ID, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 400 when items is empty', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: { customerId: CUSTOMER_ID, items: [] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when a quantity is not a positive integer', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: { customerId: CUSTOMER_ID, items: [{ productId: PRODUCT_A, quantity: 0 }] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when the customerId is not a UUID', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/sales',
        headers: authHeader(ctx.token),
        payload: { customerId: 'not-a-uuid', items: [{ productId: PRODUCT_A, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/sales', () => {
    it('returns a paginated list scoped to the tenant', async () => {
      ctx = await buildTestApp();
      seedSale(ctx, { id: '10000000-0000-0000-0000-000000000001', saleNumber: 'SALE-000001' });
      seedSale(ctx, { id: '10000000-0000-0000-0000-000000000002', saleNumber: 'SALE-000002' });
      seedSale(ctx, {
        id: '10000000-0000-0000-0000-000000000003',
        tenantId: OTHER_TENANT_ID,
        saleNumber: 'SALE-000003',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/sales?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toMatchObject({ total: 2, page: 1, pageSize: 10 });
      expect(body.items).toHaveLength(2);
    });

    it('filters by customerId', async () => {
      ctx = await buildTestApp();
      seedSale(ctx, { id: '11000000-0000-0000-0000-000000000001', saleNumber: 'SALE-000001' });
      seedSale(ctx, {
        id: '11000000-0000-0000-0000-000000000002',
        customerId: '5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a',
        saleNumber: 'SALE-000002',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/sales?customerId=${CUSTOMER_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].customerId).toBe(CUSTOMER_ID);
    });

    it('filters by saleDate range', async () => {
      ctx = await buildTestApp();
      seedSale(ctx, {
        id: '12000000-0000-0000-0000-000000000001',
        saleNumber: 'SALE-000001',
        saleDate: new Date('2024-01-01T00:00:00.000Z'),
      });
      seedSale(ctx, {
        id: '12000000-0000-0000-0000-000000000002',
        saleNumber: 'SALE-000002',
        saleDate: new Date('2024-06-01T00:00:00.000Z'),
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/sales?from=2024-05-01T00:00:00.000Z&to=2024-07-01T00:00:00.000Z',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].saleNumber).toBe('SALE-000002');
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/sales?page=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/sales/:id', () => {
    it('returns 200 with the sale and its line items', async () => {
      ctx = await buildTestApp();
      const seeded = seedSale(ctx, { id: '20000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/sales/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(seeded.id);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ productId: PRODUCT_A, quantity: 2 });
    });

    it('returns 404 when the sale does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/sales/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 for a sale owned by another tenant', async () => {
      ctx = await buildTestApp();
      const seeded = seedSale(ctx, {
        id: '20000000-0000-0000-0000-000000000002',
        tenantId: OTHER_TENANT_ID,
      });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/sales/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/sales/:id/status', () => {
    it('completes a draft sale, returns 200 and publishes SaleCompleted', async () => {
      ctx = await buildTestApp();
      const seeded = seedSale(ctx, {
        id: '30000000-0000-0000-0000-000000000001',
        status: 'draft',
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/sales/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'completed' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('completed');
      expect(ctx.publishedEvents.map((e) => e.eventName())).toContain('SaleCompleted');
    });

    it('cancels a completed sale and returns 200', async () => {
      ctx = await buildTestApp();
      const seeded = seedSale(ctx, {
        id: '30000000-0000-0000-0000-000000000002',
        status: 'completed',
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/sales/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'cancelled' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('cancelled');
    });

    it('returns 422 on an illegal transition (completed -> completed)', async () => {
      ctx = await buildTestApp();
      const seeded = seedSale(ctx, {
        id: '30000000-0000-0000-0000-000000000003',
        status: 'completed',
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/sales/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'completed' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 404 when the sale does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/sales/${MISSING_ID}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'cancelled' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 400 on an invalid status value', async () => {
      ctx = await buildTestApp();
      const seeded = seedSale(ctx, { id: '30000000-0000-0000-0000-000000000004' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/sales/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'shipped' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/sales/:id', () => {
    it('soft-deletes a sale and returns 204', async () => {
      ctx = await buildTestApp();
      const seeded = seedSale(ctx, { id: '40000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/sales/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(204);
      expect(await ctx.sales.findById(seeded.id)).toBeNull();
    });

    it('returns 404 when deleting a missing sale', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/sales/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });
});
