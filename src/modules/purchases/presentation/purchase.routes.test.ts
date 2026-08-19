import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, PURCHASE_TOKENS } from '@infrastructure/di/index.js';
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
import { Purchase } from '../domain/entities/purchase.js';
import { PurchaseDetail } from '../domain/entities/purchase-detail.js';
import type {
  PurchaseQuery,
  IPurchaseRepository,
} from '../domain/repositories/purchase-repository.js';
import type {
  IPurchaseUnitOfWork,
  PurchaseTransactionContext,
} from '../domain/repositories/purchase-unit-of-work.js';
import type {
  IPurchaseProductReader,
  ProductCost,
} from '../domain/ports/purchase-product-reader.js';
import type { IPurchaseSupplierReader } from '../domain/ports/purchase-supplier-reader.js';
import type { PurchaseStatus } from '../domain/value-objects/purchase-status.js';
import { CreatePurchaseUseCase } from '../application/use-cases/create-purchase.use-case.js';
import { GetPurchaseUseCase } from '../application/use-cases/get-purchase.use-case.js';
import { ListPurchasesUseCase } from '../application/use-cases/list-purchases.use-case.js';
import { UpdatePurchaseStatusUseCase } from '../application/use-cases/update-purchase-status.use-case.js';
import { DeletePurchaseUseCase } from '../application/use-cases/delete-purchase.use-case.js';
import { registerPurchaseRoutes } from './purchase.routes.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const SUPPLIER_ID = '55555555-5555-5555-5555-555555555555';
const PRODUCT_A = '77777777-7777-7777-7777-777777777777';
const PRODUCT_B = '88888888-8888-8888-8888-888888888888';
// A product that exists in the catalogue but has no recorded cost (cost === null).
const PRODUCT_NO_COST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CURRENCY = 'ARS';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemoryPurchaseRepository implements IPurchaseRepository {
  private readonly byId = new Map<UUID, Purchase>();
  private sequence = 0;

  seed(purchase: Purchase): void {
    this.byId.set(purchase.id, purchase);
  }

  async findById(id: UUID): Promise<Purchase | null> {
    return this.byId.get(id) ?? null;
  }

  async findMany(tenantId: UUID, query: PurchaseQuery): Promise<PaginatedResult<Purchase>> {
    const filters = query.filters ?? {};
    let items = [...this.byId.values()].filter((p) => p.tenantId === tenantId);

    if (filters.supplierId !== undefined) {
      items = items.filter((p) => p.supplierId === filters.supplierId);
    }
    if (filters.status !== undefined) {
      items = items.filter((p) => p.status === filters.status);
    }
    if (filters.from !== undefined) {
      const from = filters.from;
      items = items.filter((p) => p.purchaseDate.getTime() >= from.getTime());
    }
    if (filters.to !== undefined) {
      const to = filters.to;
      items = items.filter((p) => p.purchaseDate.getTime() <= to.getTime());
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

  async create(purchase: Purchase): Promise<Purchase> {
    this.byId.set(purchase.id, purchase);
    return purchase;
  }

  async updateStatus(id: UUID, _status: PurchaseStatus): Promise<void> {
    // The use case mutates the loaded aggregate in place before calling this,
    // so the stored reference already carries the new status; nothing else to
    // persist for the in-memory fake beyond confirming the row exists.
    if (!this.byId.has(id)) {
      throw new Error(`Purchase ${id} not found`);
    }
  }

  async softDelete(id: UUID): Promise<void> {
    this.byId.delete(id);
  }

  async nextPurchaseNumber(_tenantId: UUID): Promise<string> {
    this.sequence += 1;
    return `PUR-${String(this.sequence).padStart(6, '0')}`;
  }
}

class InMemoryPurchaseUnitOfWork implements IPurchaseUnitOfWork {
  constructor(private readonly purchases: IPurchaseRepository) {}

  execute<T>(work: (ctx: PurchaseTransactionContext) => Promise<T>): Promise<T> {
    return work({ purchases: this.purchases });
  }
}

class FakeProductReader implements IPurchaseProductReader {
  async findCost(_tenantId: UUID, productId: UUID): Promise<ProductCost | null> {
    if (productId === PRODUCT_A) {
      return { productId, unitCost: Money.fromDecimal('100.00', CURRENCY), taxRate: 21 };
    }
    if (productId === PRODUCT_B) {
      return { productId, unitCost: Money.fromDecimal('50.00', CURRENCY), taxRate: 0 };
    }
    if (productId === PRODUCT_NO_COST) {
      // Product exists but has no recorded catalogue cost.
      return { productId, unitCost: null, taxRate: 10 };
    }
    return null;
  }
}

class FakeSupplierReader implements IPurchaseSupplierReader {
  async exists(_tenantId: UUID, supplierId: UUID): Promise<boolean> {
    return supplierId === SUPPLIER_ID;
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
  purchases: InMemoryPurchaseRepository;
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
        permissions: [Permission.create('purchases', '*', 'read')],
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

  const purchases = new InMemoryPurchaseRepository();
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
  const suppliers = new FakeSupplierReader();
  const unitOfWork = new InMemoryPurchaseUnitOfWork(purchases);

  const container = new Container();
  container.registerValue(
    PURCHASE_TOKENS.CreatePurchaseUseCase,
    new CreatePurchaseUseCase(unitOfWork, products, suppliers, bus),
  );
  container.registerValue(PURCHASE_TOKENS.GetPurchaseUseCase, new GetPurchaseUseCase(purchases));
  container.registerValue(
    PURCHASE_TOKENS.ListPurchasesUseCase,
    new ListPurchasesUseCase(purchases),
  );
  container.registerValue(
    PURCHASE_TOKENS.UpdatePurchaseStatusUseCase,
    new UpdatePurchaseStatusUseCase(purchases, bus),
  );
  container.registerValue(
    PURCHASE_TOKENS.DeletePurchaseUseCase,
    new DeletePurchaseUseCase(purchases),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerPurchaseRoutes(app, container);
  await app.ready();

  return { app, token, purchases, publishedEvents };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

interface SeedPurchaseOverrides {
  id?: UUID;
  tenantId?: UUID;
  supplierId?: UUID;
  status?: PurchaseStatus;
  purchaseNumber?: string;
  purchaseDate?: Date;
}

/** Seeds a purchase (one line item) directly into the repository. */
function seedPurchase(ctx: TestApp, overrides: SeedPurchaseOverrides = {}): Purchase {
  const line = PurchaseDetail.create({
    productId: PRODUCT_A,
    quantity: 2,
    unitCost: Money.fromDecimal('100.00', CURRENCY),
    taxRate: 21,
  });
  const purchase = Purchase.create(
    {
      tenantId: overrides.tenantId ?? TENANT_ID,
      supplierId: overrides.supplierId ?? SUPPLIER_ID,
      userId: USER_ID,
      purchaseNumber: overrides.purchaseNumber ?? 'PUR-000100',
      currency: CURRENCY,
      items: [line],
      ...(overrides.purchaseDate !== undefined ? { purchaseDate: overrides.purchaseDate } : {}),
    },
    overrides.id,
  );
  const status = overrides.status ?? 'completed';
  if (status === 'completed') {
    purchase.complete();
    purchase.pullDomainEvents(); // discard the seed-time PurchaseCompleted event
  } else if (status === 'cancelled') {
    purchase.cancel();
  }
  ctx.purchases.seed(purchase);
  return purchase;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('purchase routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/purchases' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the write permission (create as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_A, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/purchases', () => {
    it('creates a purchase with authoritative cost and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: {
          supplierId: SUPPLIER_ID,
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
        supplierId: SUPPLIER_ID,
        userId: USER_ID,
        status: 'completed',
        currency: CURRENCY,
      });
      // 2*100 + 3*50 = 350 subtotal; tax = 2*100*0.21 = 42; total = 392.
      expect(body.subtotal).toBe('350.00');
      expect(body.taxAmount).toBe('42.00');
      expect(body.total).toBe('392.00');
      expect(body.items).toHaveLength(2);
      // Client sent no cost; the catalogue reader is authoritative.
      expect(body.items[0]).toMatchObject({ productId: PRODUCT_A, unitCost: '100.00' });
      // A completed purchase publishes PurchaseCompleted.
      expect(ctx.publishedEvents.map((e) => e.eventName())).toContain('PurchaseCompleted');
    });

    it('creates a draft purchase without publishing PurchaseCompleted', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: {
          supplierId: SUPPLIER_ID,
          items: [{ productId: PRODUCT_A, quantity: 1 }],
          status: 'draft',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('draft');
      expect(ctx.publishedEvents).toHaveLength(0);
    });

    it('uses the client unitCost only when the catalogue cost is absent', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: {
          supplierId: SUPPLIER_ID,
          items: [{ productId: PRODUCT_NO_COST, quantity: 2, unitCost: '10.00' }],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.items[0]).toMatchObject({ productId: PRODUCT_NO_COST, unitCost: '10.00' });
      // 2*10 = 20 subtotal; tax = 20*0.10 = 2; total = 22.
      expect(body.subtotal).toBe('20.00');
      expect(body.taxAmount).toBe('2.00');
      expect(body.total).toBe('22.00');
    });

    it('returns 400 when the catalogue cost is absent and no unitCost is supplied', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_NO_COST, quantity: 1 }] },
      });
      // MissingProductCostError extends ValidationError -> 400 VALIDATION_ERROR.
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when the supplier does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: { supplierId: MISSING_ID, items: [{ productId: PRODUCT_A, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 when a product does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: { supplierId: SUPPLIER_ID, items: [{ productId: MISSING_ID, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 400 when items is empty', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: { supplierId: SUPPLIER_ID, items: [] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when a quantity is not a positive integer', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: { supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_A, quantity: 0 }] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when the supplierId is not a UUID', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/purchases',
        headers: authHeader(ctx.token),
        payload: { supplierId: 'not-a-uuid', items: [{ productId: PRODUCT_A, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/purchases', () => {
    it('returns a paginated list scoped to the tenant', async () => {
      ctx = await buildTestApp();
      seedPurchase(ctx, { id: '10000000-0000-0000-0000-000000000001', purchaseNumber: 'PUR-000001' });
      seedPurchase(ctx, { id: '10000000-0000-0000-0000-000000000002', purchaseNumber: 'PUR-000002' });
      seedPurchase(ctx, {
        id: '10000000-0000-0000-0000-000000000003',
        tenantId: OTHER_TENANT_ID,
        purchaseNumber: 'PUR-000003',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/purchases?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toMatchObject({ total: 2, page: 1, pageSize: 10 });
      expect(body.items).toHaveLength(2);
    });

    it('filters by supplierId', async () => {
      ctx = await buildTestApp();
      seedPurchase(ctx, { id: '11000000-0000-0000-0000-000000000001', purchaseNumber: 'PUR-000001' });
      seedPurchase(ctx, {
        id: '11000000-0000-0000-0000-000000000002',
        supplierId: '5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a',
        purchaseNumber: 'PUR-000002',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/purchases?supplierId=${SUPPLIER_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].supplierId).toBe(SUPPLIER_ID);
    });

    it('filters by status', async () => {
      ctx = await buildTestApp();
      seedPurchase(ctx, {
        id: '13000000-0000-0000-0000-000000000001',
        purchaseNumber: 'PUR-000001',
        status: 'completed',
      });
      seedPurchase(ctx, {
        id: '13000000-0000-0000-0000-000000000002',
        purchaseNumber: 'PUR-000002',
        status: 'draft',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/purchases?status=draft',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].status).toBe('draft');
    });

    it('filters by purchaseDate range', async () => {
      ctx = await buildTestApp();
      seedPurchase(ctx, {
        id: '12000000-0000-0000-0000-000000000001',
        purchaseNumber: 'PUR-000001',
        purchaseDate: new Date('2024-01-01T00:00:00.000Z'),
      });
      seedPurchase(ctx, {
        id: '12000000-0000-0000-0000-000000000002',
        purchaseNumber: 'PUR-000002',
        purchaseDate: new Date('2024-06-01T00:00:00.000Z'),
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/purchases?from=2024-05-01T00:00:00.000Z&to=2024-07-01T00:00:00.000Z',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].purchaseNumber).toBe('PUR-000002');
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/purchases?page=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/purchases/:id', () => {
    it('returns 200 with the purchase and its line items', async () => {
      ctx = await buildTestApp();
      const seeded = seedPurchase(ctx, { id: '20000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/purchases/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(seeded.id);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ productId: PRODUCT_A, quantity: 2 });
    });

    it('returns 404 when the purchase does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/purchases/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 for a purchase owned by another tenant', async () => {
      ctx = await buildTestApp();
      const seeded = seedPurchase(ctx, {
        id: '20000000-0000-0000-0000-000000000002',
        tenantId: OTHER_TENANT_ID,
      });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/purchases/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/purchases/:id/status', () => {
    it('completes a draft purchase, returns 200 and publishes PurchaseCompleted', async () => {
      ctx = await buildTestApp();
      const seeded = seedPurchase(ctx, {
        id: '30000000-0000-0000-0000-000000000001',
        status: 'draft',
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/purchases/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'completed' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('completed');
      expect(ctx.publishedEvents.map((e) => e.eventName())).toContain('PurchaseCompleted');
    });

    it('cancels a completed purchase and returns 200', async () => {
      ctx = await buildTestApp();
      const seeded = seedPurchase(ctx, {
        id: '30000000-0000-0000-0000-000000000002',
        status: 'completed',
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/purchases/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'cancelled' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('cancelled');
    });

    it('returns 422 on an illegal transition (completed -> completed)', async () => {
      ctx = await buildTestApp();
      const seeded = seedPurchase(ctx, {
        id: '30000000-0000-0000-0000-000000000003',
        status: 'completed',
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/purchases/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'completed' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 404 when the purchase does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/purchases/${MISSING_ID}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'cancelled' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 400 on an invalid status value', async () => {
      ctx = await buildTestApp();
      const seeded = seedPurchase(ctx, { id: '30000000-0000-0000-0000-000000000004' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/purchases/${seeded.id}/status`,
        headers: authHeader(ctx.token),
        payload: { status: 'received' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/purchases/:id', () => {
    it('soft-deletes a purchase and returns 204', async () => {
      ctx = await buildTestApp();
      const seeded = seedPurchase(ctx, { id: '40000000-0000-0000-0000-000000000001' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/purchases/${seeded.id}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(204);
      expect(await ctx.purchases.findById(seeded.id)).toBeNull();
    });

    it('returns 404 when deleting a missing purchase', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/purchases/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });
});
