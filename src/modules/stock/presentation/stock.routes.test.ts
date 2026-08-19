import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, STOCK_TOKENS } from '@infrastructure/di/index.js';
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
import { Stock } from '../domain/entities/stock.js';
import type { StockMovement } from '../domain/entities/stock-movement.js';
import type {
  IStockRepository,
  StockLevelQuery,
  StockLevelView,
} from '../domain/repositories/stock-repository.js';
import type {
  IStockMovementRepository,
  StockMovementQuery,
} from '../domain/repositories/stock-movement-repository.js';
import type {
  IStockMovementCursorReader,
  StockMovementCursorQuery,
} from '../domain/repositories/stock-movement-cursor-reader.js';
import type {
  IStockUnitOfWork,
  StockTransactionContext,
} from '../domain/repositories/stock-unit-of-work.js';
import { AdjustStockUseCase } from '../application/use-cases/adjust-stock.use-case.js';
import { GetStockLevelsUseCase } from '../application/use-cases/get-stock-levels.use-case.js';
import { GetStockMovementHistoryUseCase } from '../application/use-cases/get-stock-movement-history.use-case.js';
import { ListStockMovementsByCursorUseCase } from '../application/use-cases/list-stock-movements-by-cursor.use-case.js';
import { registerStockRoutes } from './stock.routes.js';
import { buildCursorPage, decodeCursor, type CursorPage } from '@shared/pagination/cursor.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const PRODUCT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BRANCH_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const BRANCH_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

interface ProductMeta {
  name: string;
  minStock: number;
}

function branchKey(branchId: Nullable<UUID>): string {
  return branchId ?? '__tenant__';
}

class InMemoryStockRepository implements IStockRepository {
  private readonly balances = new Map<string, Stock>();
  private readonly products = new Map<UUID, ProductMeta>();

  seedProduct(productId: UUID, meta: ProductMeta): void {
    this.products.set(productId, meta);
  }

  seedBalance(stock: Stock): void {
    this.balances.set(this.key(stock.tenantId, stock.productId, stock.branchId), stock);
  }

  private key(tenantId: UUID, productId: UUID, branchId: Nullable<UUID>): string {
    return `${tenantId}::${productId}::${branchKey(branchId)}`;
  }

  async findByProductBranch(
    tenantId: UUID,
    productId: UUID,
    branchId: Nullable<UUID>,
  ): Promise<Stock | null> {
    return this.balances.get(this.key(tenantId, productId, branchId)) ?? null;
  }

  async findByTenant(
    tenantId: UUID,
    query: StockLevelQuery,
  ): Promise<PaginatedResult<StockLevelView>> {
    return this.page(this.viewsFor(tenantId, query), query);
  }

  async findLowStock(
    tenantId: UUID,
    query: StockLevelQuery,
  ): Promise<PaginatedResult<StockLevelView>> {
    const low = this.viewsFor(tenantId, query).filter((v) => v.stock.isLow(v.minStock));
    return this.page(low, query);
  }

  async save(stock: Stock): Promise<Stock> {
    this.balances.set(this.key(stock.tenantId, stock.productId, stock.branchId), stock);
    return stock;
  }

  private viewsFor(tenantId: UUID, query: StockLevelQuery): StockLevelView[] {
    const filters = query.filters ?? {};
    return [...this.balances.values()]
      .filter((stock) => stock.tenantId === tenantId)
      .filter((stock) => filters.productId === undefined || stock.productId === filters.productId)
      .filter(
        (stock) => filters.branchId === undefined || stock.branchId === (filters.branchId ?? null),
      )
      .map((stock) => {
        const meta = this.products.get(stock.productId) ?? { name: 'Unknown', minStock: 0 };
        return { stock, productName: meta.name, minStock: meta.minStock };
      });
  }

  private page(items: StockLevelView[], query: StockLevelQuery): PaginatedResult<StockLevelView> {
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

class InMemoryStockMovementRepository
  implements IStockMovementRepository, IStockMovementCursorReader
{
  private readonly movements: StockMovement[] = [];

  async create(movement: StockMovement): Promise<StockMovement> {
    this.movements.push(movement);
    return movement;
  }

  /** Applies the shared filters and returns matches newest-first (id tie-break). */
  private matches(tenantId: UUID, query: { filters?: StockMovementQuery['filters'] }): StockMovement[] {
    const filters = query.filters ?? {};
    return this.movements
      .filter((m) => m.tenantId === tenantId)
      .filter((m) => filters.productId === undefined || m.productId === filters.productId)
      .filter((m) => filters.branchId === undefined || m.branchId === (filters.branchId ?? null))
      .filter((m) => filters.type === undefined || m.type === filters.type)
      .filter((m) => filters.from === undefined || m.createdAt >= filters.from)
      .filter((m) => filters.to === undefined || m.createdAt <= filters.to)
      .sort((a, b) => {
        const byDate = b.createdAt.getTime() - a.createdAt.getTime();
        return byDate !== 0 ? byDate : (a.id < b.id ? 1 : -1);
      });
  }

  async findMany(
    tenantId: UUID,
    query: StockMovementQuery,
  ): Promise<PaginatedResult<StockMovement>> {
    const items = this.matches(tenantId, query);
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

  async findManyByCursor(
    tenantId: UUID,
    query: StockMovementCursorQuery,
  ): Promise<CursorPage<StockMovement>> {
    const ordered = this.matches(tenantId, query);
    const decoded = decodeCursor(query.cursor);
    const startIndex =
      decoded === null ? 0 : ordered.findIndex((m) => m.id === decoded.id) + 1;
    // Over-fetch limit+1 to let buildCursorPage decide whether more pages exist.
    const slice = ordered.slice(startIndex, startIndex + query.limit + 1);
    return buildCursorPage(slice, query.limit, (m) => m.id);
  }
}

/** Unit of work that runs the callback against the shared in-memory repos. */
class InMemoryStockUnitOfWork implements IStockUnitOfWork {
  constructor(
    private readonly stocks: IStockRepository,
    private readonly movements: IStockMovementRepository,
  ) {}

  async execute<T>(work: (ctx: StockTransactionContext) => Promise<T>): Promise<T> {
    const ctx: StockTransactionContext = { stocks: this.stocks, movements: this.movements };
    return work(ctx);
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
  stocks: InMemoryStockRepository;
  movements: InMemoryStockMovementRepository;
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
        permissions: [Permission.create('stock', '*', 'read')],
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

  const stocks = new InMemoryStockRepository();
  stocks.seedProduct(PRODUCT_A, { name: 'Wireless Mouse', minStock: 5 });
  stocks.seedProduct(PRODUCT_B, { name: 'Mechanical Keyboard', minStock: 10 });
  // Product A: 20 on hand (healthy). Product B: 2 on hand (low, minStock 10).
  stocks.seedBalance(Stock.create({ tenantId: TENANT_ID, productId: PRODUCT_A, quantity: 20 }));
  stocks.seedBalance(Stock.create({ tenantId: TENANT_ID, productId: PRODUCT_B, quantity: 2 }));

  const movements = new InMemoryStockMovementRepository();
  const uow = new InMemoryStockUnitOfWork(stocks, movements);

  const container = new Container();
  container.registerValue(STOCK_TOKENS.AdjustStockUseCase, new AdjustStockUseCase(uow));
  container.registerValue(STOCK_TOKENS.GetStockLevelsUseCase, new GetStockLevelsUseCase(stocks));
  container.registerValue(
    STOCK_TOKENS.GetStockMovementHistoryUseCase,
    new GetStockMovementHistoryUseCase(movements),
  );
  container.registerValue(
    STOCK_TOKENS.ListStockMovementsByCursorUseCase,
    new ListStockMovementsByCursorUseCase(movements),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerStockRoutes(app, container);
  await app.ready();

  return { app, token, stocks, movements };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stock routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/stock' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the write permission (adjust as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: { productId: PRODUCT_A, type: 'IN', quantity: 5 },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/stock/adjust', () => {
    it('applies an IN movement, increases the balance and returns 200', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: { productId: PRODUCT_A, type: 'IN', quantity: 10, reference: 'manual' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.stocks).toHaveLength(1);
      expect(body.stocks[0].quantity).toBe(30);
      expect(body.movements).toHaveLength(1);
      expect(body.movements[0]).toMatchObject({ type: 'IN', quantity: 10, reference: 'manual' });
    });

    it('returns 422 when an OUT movement exceeds the available quantity', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: { productId: PRODUCT_B, type: 'OUT', quantity: 100 },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 400 when a TRANSFER omits the destination branch', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: { productId: PRODUCT_A, branchId: BRANCH_A, type: 'TRANSFER', quantity: 5 },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when quantity is not positive', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: { productId: PRODUCT_A, type: 'IN', quantity: 0 },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('moves units between branches for a valid TRANSFER', async () => {
      ctx = await buildTestApp();
      // Seed a branch-A balance to transfer from.
      ctx.stocks.seedBalance(
        Stock.create({ tenantId: TENANT_ID, productId: PRODUCT_A, branchId: BRANCH_A, quantity: 8 }),
      );
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: {
          productId: PRODUCT_A,
          branchId: BRANCH_A,
          destinationBranchId: BRANCH_B,
          type: 'TRANSFER',
          quantity: 3,
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.stocks).toHaveLength(2);
      expect(body.movements).toHaveLength(2);
    });
  });

  describe('GET /api/v1/stock', () => {
    it('returns paginated stock levels with the lowStock flag', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toMatchObject({ total: 2, page: 1, pageSize: 10 });
      const byProduct = new Map<string, boolean>(
        body.items.map((i: { productId: string; lowStock: boolean }) => [i.productId, i.lowStock]),
      );
      expect(byProduct.get(PRODUCT_A)).toBe(false);
      expect(byProduct.get(PRODUCT_B)).toBe(true);
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock?productId=not-a-uuid',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/stock/alerts', () => {
    it('returns only the low-stock items', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock/alerts',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].productId).toBe(PRODUCT_B);
      expect(body.items[0].lowStock).toBe(true);
    });
  });

  describe('GET /api/v1/stock/movements', () => {
    it('returns the movement history filtered by type', async () => {
      ctx = await buildTestApp();
      // Create two movements: one IN and one OUT.
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: { productId: PRODUCT_A, type: 'IN', quantity: 5 },
      });
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/stock/adjust',
        headers: authHeader(ctx.token),
        payload: { productId: PRODUCT_A, type: 'OUT', quantity: 2 },
      });

      const all = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock/movements',
        headers: authHeader(ctx.token),
      });
      expect(all.statusCode).toBe(200);
      expect(all.json().meta.total).toBe(2);

      const outOnly = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock/movements?type=OUT',
        headers: authHeader(ctx.token),
      });
      expect(outOnly.statusCode).toBe(200);
      const body = outOnly.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe('OUT');
    });

    it('returns 400 on an invalid movement type filter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock/movements?type=BOGUS',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/stock/movements/cursor', () => {
    /** Records `count` IN movements for product A via the adjust endpoint. */
    async function seedMovements(count: number): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/stock/adjust',
          headers: authHeader(ctx.token),
          payload: { productId: PRODUCT_A, type: 'IN', quantity: 1 },
        });
      }
    }

    it('walks the full history across cursor pages without gaps or duplicates', async () => {
      ctx = await buildTestApp();
      await seedMovements(5);

      const first = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock/movements/cursor?limit=2',
        headers: authHeader(ctx.token),
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json();
      expect(firstBody.items).toHaveLength(2);
      expect(firstBody.hasMore).toBe(true);
      expect(firstBody.nextCursor).not.toBeNull();

      const seen = new Set<string>(firstBody.items.map((i: { id: string }) => i.id));
      let cursor: string | null = firstBody.nextCursor;
      let guard = 0;
      while (cursor !== null && guard < 10) {
        const page = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/stock/movements/cursor?limit=2&cursor=${encodeURIComponent(cursor)}`,
          headers: authHeader(ctx.token),
        });
        expect(page.statusCode).toBe(200);
        const body = page.json();
        for (const item of body.items as Array<{ id: string }>) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
        }
        cursor = body.nextCursor;
        guard += 1;
      }

      // All five distinct movements were visited exactly once.
      expect(seen.size).toBe(5);
    });

    it('returns 400 on an invalid movement type filter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/stock/movements/cursor?type=BOGUS',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });
});
