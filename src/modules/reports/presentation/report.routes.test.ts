import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, REPORT_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import { registerFeatureFlagAuthorization } from '@presentation/middlewares/feature-flag.js';
import { Money } from '@shared/value-objects/money.js';
import type { UUID } from '@shared/types/index.js';
import { JwtTokenService } from '../../auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../auth/domain/entities/auth-user.js';
import { Role } from '../../authorization/domain/entities/role.js';
import { Permission } from '../../authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../authorization/domain/repositories/role-repository.js';
import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../../subscriptions/domain/services/feature-access-service.js';
import type {
  ISalesReportReader,
  SalesReportData,
} from '../domain/ports/sales-report-reader.js';
import type { IStockReportReader, StockReportData } from '../domain/ports/stock-report-reader.js';
import type {
  ICashFlowReportReader,
  CashFlowReportData,
} from '../domain/ports/cash-flow-report-reader.js';
import type {
  ICustomerReportReader,
  CustomerReportData,
} from '../domain/ports/customer-report-reader.js';
import type {
  IProductPerformanceReader,
  ProductPerformanceData,
} from '../domain/ports/product-performance-reader.js';
import { SalesReportUseCase } from '../application/use-cases/sales-report.use-case.js';
import { StockReportUseCase } from '../application/use-cases/stock-report.use-case.js';
import { CashFlowReportUseCase } from '../application/use-cases/cash-flow-report.use-case.js';
import { CustomerReportUseCase } from '../application/use-cases/customer-report.use-case.js';
import { ProductPerformanceReportUseCase } from '../application/use-cases/product-performance-report.use-case.js';
import { registerReportRoutes } from './report.routes.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const CUSTOMER_ID = '55555555-5555-5555-5555-555555555555';
const PRODUCT_ID = '66666666-6666-6666-6666-666666666666';
const CURRENCY = 'ARS';

// ---------------------------------------------------------------------------
// In-memory reader fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemorySalesReportReader implements ISalesReportReader {
  async salesSummary(): Promise<SalesReportData> {
    return {
      totals: {
        count: 2,
        subtotal: Money.fromDecimal('100.00', CURRENCY),
        tax: Money.fromDecimal('21.00', CURRENCY),
        total: Money.fromDecimal('121.00', CURRENCY),
      },
      daily: [
        {
          date: '2026-01-01',
          count: 1,
          subtotal: Money.fromDecimal('40.00', CURRENCY),
          tax: Money.fromDecimal('8.40', CURRENCY),
          total: Money.fromDecimal('48.40', CURRENCY),
        },
        {
          date: '2026-01-02',
          count: 1,
          subtotal: Money.fromDecimal('60.00', CURRENCY),
          tax: Money.fromDecimal('12.60', CURRENCY),
          total: Money.fromDecimal('72.60', CURRENCY),
        },
      ],
    };
  }
}

class InMemoryStockReportReader implements IStockReportReader {
  async stockLevels(): Promise<StockReportData> {
    const low = {
      productId: PRODUCT_ID,
      productName: 'Widget, Deluxe',
      sku: 'SKU-1',
      branchId: null,
      quantity: 2,
      minStock: 5,
      isLowStock: true,
    };
    const ok = {
      productId: '77777777-7777-7777-7777-777777777777',
      productName: 'Gadget',
      sku: 'SKU-2',
      branchId: null,
      quantity: 20,
      minStock: 5,
      isLowStock: false,
    };
    return { items: [low, ok], lowStock: [low], totalItems: 2, lowStockCount: 1 };
  }
}

class InMemoryCashFlowReportReader implements ICashFlowReportReader {
  async cashFlow(): Promise<CashFlowReportData> {
    return {
      income: Money.fromDecimal('300.00', CURRENCY),
      expense: Money.fromDecimal('120.00', CURRENCY),
      net: Money.fromDecimal('180.00', CURRENCY),
      byCategory: [
        {
          type: 'INCOME',
          category: 'sale',
          total: Money.fromDecimal('300.00', CURRENCY),
          count: 3,
        },
        {
          type: 'EXPENSE',
          category: 'purchase',
          total: Money.fromDecimal('120.00', CURRENCY),
          count: 1,
        },
      ],
    };
  }
}

class InMemoryCustomerReportReader implements ICustomerReportReader {
  async topCustomers(): Promise<CustomerReportData> {
    return {
      customers: [
        {
          customerId: CUSTOMER_ID,
          customerName: 'Acme "Corp", Inc',
          salesCount: 4,
          totalPurchased: Money.fromDecimal('500.00', CURRENCY),
        },
      ],
    };
  }
}

class InMemoryProductPerformanceReader implements IProductPerformanceReader {
  async productPerformance(): Promise<ProductPerformanceData> {
    return {
      products: [
        {
          productId: PRODUCT_ID,
          productName: 'Widget',
          sku: 'SKU-1',
          quantitySold: 30,
          revenue: Money.fromDecimal('900.00', CURRENCY),
        },
      ],
    };
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
  // A role that can read sales but has NO reports permission, so it is refused
  // the report endpoints with a 403 (RBAC), independent of the feature guard.
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

  const container = new Container();
  container.registerValue(
    REPORT_TOKENS.SalesReportUseCase,
    new SalesReportUseCase(new InMemorySalesReportReader()),
  );
  container.registerValue(
    REPORT_TOKENS.StockReportUseCase,
    new StockReportUseCase(new InMemoryStockReportReader()),
  );
  container.registerValue(
    REPORT_TOKENS.CashFlowReportUseCase,
    new CashFlowReportUseCase(new InMemoryCashFlowReportReader()),
  );
  container.registerValue(
    REPORT_TOKENS.CustomerReportUseCase,
    new CustomerReportUseCase(new InMemoryCustomerReportReader()),
  );
  container.registerValue(
    REPORT_TOKENS.ProductPerformanceReportUseCase,
    new ProductPerformanceReportUseCase(new InMemoryProductPerformanceReader()),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerReportRoutes(app, container);
  await app.ready();

  return { app, token };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Splits a CSV document into its RFC 4180 records (CRLF-separated). */
function csvRecords(body: string): string[] {
  return body.split('\r\n');
}

const REPORT_PATHS = [
  '/api/v1/reports/sales',
  '/api/v1/reports/stock',
  '/api/v1/reports/cash-flow',
  '/api/v1/reports/customers',
  '/api/v1/reports/products',
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('report routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/reports/sales' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the reports read permission', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/sales',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the reports feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/sales',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('guards every report endpoint against unauthenticated access', async () => {
      ctx = await buildTestApp();
      for (const url of REPORT_PATHS) {
        const response = await ctx.app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(401);
      }
    });
  });

  describe('GET /api/v1/reports/sales', () => {
    it('returns 200 JSON with window totals and per-day breakdown', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/sales',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.totals).toMatchObject({ count: 2, subtotal: '100.00', total: '121.00' });
      expect(body.daily).toHaveLength(2);
      expect(body.daily[0]).toMatchObject({ date: '2026-01-01', total: '48.40' });
    });

    it('returns a CSV export with the per-day rows and download headers', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/sales?format=csv',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="sales-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      const records = csvRecords(response.body);
      expect(records[0]).toBe('date,count,subtotal,tax,total');
      expect(records).toHaveLength(3); // header + 2 days
      expect(records[1]).toBe('2026-01-01,1,40.00,8.40,48.40');
    });

    it('returns 400 when the date range is inverted (from > to)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/sales?from=2026-02-01&to=2026-01-01',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 on a malformed customerId', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/sales?customerId=not-a-uuid',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/reports/stock', () => {
    it('returns 200 JSON with stock levels and low-stock subset', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/stock',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.totalItems).toBe(2);
      expect(body.lowStockCount).toBe(1);
      expect(body.lowStock[0]).toMatchObject({ sku: 'SKU-1', isLowStock: true });
    });

    it('returns a CSV export escaping a product name that contains a comma', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/stock?format=csv',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('stock-');
      const records = csvRecords(response.body);
      expect(records[0]).toBe(
        'productId,productName,sku,branchId,quantity,minStock,isLowStock',
      );
      // "Widget, Deluxe" contains a comma and must be quoted.
      expect(records[1]).toContain('"Widget, Deluxe"');
      expect(records[1]).toContain(',,'); // null branchId → empty field
      expect(records).toHaveLength(3);
    });
  });

  describe('GET /api/v1/reports/cash-flow', () => {
    it('returns 200 JSON with income/expense/net and category buckets', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/cash-flow',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ income: '300.00', expense: '120.00', net: '180.00' });
      expect(body.byCategory).toHaveLength(2);
    });

    it('returns a CSV export of the category buckets', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/cash-flow?format=csv',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const records = csvRecords(response.body);
      expect(records[0]).toBe('type,category,total,count');
      expect(records[1]).toBe('INCOME,sale,300.00,3');
      expect(records).toHaveLength(3);
    });

    it('returns 400 when the date range is inverted', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/cash-flow?from=2026-03-01&to=2026-01-01',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/reports/customers', () => {
    it('returns 200 JSON with the ranked customers', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/customers',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.customers).toHaveLength(1);
      expect(body.customers[0]).toMatchObject({ salesCount: 4, totalPurchased: '500.00' });
    });

    it('returns a CSV export escaping a customer name with a quote and comma', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/customers?format=csv',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const records = csvRecords(response.body);
      expect(records[0]).toBe('customerId,customerName,salesCount,totalPurchased');
      // 'Acme "Corp", Inc' → quoted with doubled inner quotes.
      expect(records[1]).toContain('"Acme ""Corp"", Inc"');
    });

    it('returns 400 on a non-integer limit', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/customers?limit=abc',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 on a fractional limit', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/customers?limit=2.5',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/reports/products', () => {
    it('returns 200 JSON with the ranked products', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/products',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.products).toHaveLength(1);
      expect(body.products[0]).toMatchObject({ quantitySold: 30, revenue: '900.00' });
    });

    it('returns a CSV export of the ranked products', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reports/products?format=csv',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain('products-');
      const records = csvRecords(response.body);
      expect(records[0]).toBe('productId,productName,sku,quantitySold,revenue');
      expect(records[1]).toBe(`${PRODUCT_ID},Widget,SKU-1,30,900.00`);
    });
  });
});
