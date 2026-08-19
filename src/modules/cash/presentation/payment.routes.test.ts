import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, CASH_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import { registerFeatureFlagAuthorization } from '@presentation/middlewares/feature-flag.js';
import { Money } from '@shared/value-objects/money.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { JwtTokenService } from '../../auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../auth/domain/entities/auth-user.js';
import { Role } from '../../authorization/domain/entities/role.js';
import { Permission } from '../../authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../authorization/domain/repositories/role-repository.js';
import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../../subscriptions/domain/services/feature-access-service.js';
import { Cash } from '../domain/entities/cash.js';
import type { CashMovement } from '../domain/entities/cash-movement.js';
import { Payment } from '../domain/entities/payment.js';
import type { ICashRepository, CashQuery } from '../domain/repositories/cash-repository.js';
import type {
  ICashMovementRepository,
  CashMovementQuery,
} from '../domain/repositories/cash-movement-repository.js';
import type { IPaymentRepository, PaymentQuery } from '../domain/repositories/payment-repository.js';
import type {
  ICashUnitOfWork,
  CashTransactionContext,
} from '../domain/repositories/cash-unit-of-work.js';
import type {
  IPaymentSaleReader,
  PaymentSaleTotal,
} from '../domain/ports/payment-sale-reader.js';
import type {
  IPaymentPurchaseReader,
  PaymentPurchaseTotal,
} from '../domain/ports/payment-purchase-reader.js';
import { RecordPaymentUseCase } from '../application/use-cases/record-payment.use-case.js';
import { ListPaymentsUseCase } from '../application/use-cases/list-payments.use-case.js';
import { GetPaymentStatusUseCase } from '../application/use-cases/get-payment-status.use-case.js';
import { registerPaymentRoutes } from './payment.routes.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const SALE_ID = '55555555-5555-5555-5555-555555555555';
const PURCHASE_ID = '66666666-6666-6666-6666-666666666666';
const CASH_ID = '77777777-7777-7777-7777-777777777777';
const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CURRENCY = 'ARS';

// The seeded document totals used by the fake readers.
const SALE_TOTAL = '100.00';
const PURCHASE_TOTAL = '80.00';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemoryPaymentRepository implements IPaymentRepository {
  private readonly payments: Payment[] = [];

  async create(payment: Payment): Promise<Payment> {
    this.payments.push(payment);
    return payment;
  }

  async findMany(tenantId: UUID, query: PaymentQuery): Promise<PaginatedResult<Payment>> {
    const filters = query.filters ?? {};
    let items = this.payments.filter((p) => p.tenantId === tenantId);

    if (filters.saleId !== undefined) {
      items = items.filter((p) => p.saleId === filters.saleId);
    }
    if (filters.purchaseId !== undefined) {
      items = items.filter((p) => p.purchaseId === filters.purchaseId);
    }
    if (filters.method !== undefined) {
      items = items.filter((p) => p.method === filters.method);
    }
    if (filters.from !== undefined) {
      const from = filters.from;
      items = items.filter((p) => p.date.getTime() >= from.getTime());
    }
    if (filters.to !== undefined) {
      const to = filters.to;
      items = items.filter((p) => p.date.getTime() <= to.getTime());
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

  async sumBySale(tenantId: UUID, saleId: UUID, currency: string): Promise<Money> {
    return this.payments
      .filter((p) => p.tenantId === tenantId && p.saleId === saleId)
      .reduce((acc, p) => acc.add(p.amount), Money.zero(currency));
  }

  async sumByPurchase(tenantId: UUID, purchaseId: UUID, currency: string): Promise<Money> {
    return this.payments
      .filter((p) => p.tenantId === tenantId && p.purchaseId === purchaseId)
      .reduce((acc, p) => acc.add(p.amount), Money.zero(currency));
  }
}

class InMemoryCashRepository implements ICashRepository {
  private readonly byId = new Map<UUID, Cash>();

  seed(cash: Cash): void {
    this.byId.set(cash.id, cash);
  }

  async findById(id: UUID): Promise<Cash | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTenant(tenantId: UUID, query: CashQuery): Promise<PaginatedResult<Cash>> {
    const items = [...this.byId.values()].filter((c) => c.tenantId === tenantId);
    return {
      items,
      total: items.length,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: items.length === 0 ? 0 : Math.ceil(items.length / query.pageSize),
    };
  }

  async create(cash: Cash): Promise<Cash> {
    this.byId.set(cash.id, cash);
    return cash;
  }

  async updateBalance(id: UUID, _balance: Money): Promise<void> {
    if (!this.byId.has(id)) {
      throw new Error(`Cash ${id} not found`);
    }
  }

  async save(cash: Cash): Promise<Cash> {
    this.byId.set(cash.id, cash);
    return cash;
  }
}

class InMemoryCashMovementRepository implements ICashMovementRepository {
  readonly movements: CashMovement[] = [];

  async create(movement: CashMovement): Promise<CashMovement> {
    this.movements.push(movement);
    return movement;
  }

  async findMany(
    tenantId: UUID,
    query: CashMovementQuery,
  ): Promise<PaginatedResult<CashMovement>> {
    const items = this.movements.filter((m) => m.tenantId === tenantId);
    return {
      items,
      total: items.length,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: items.length === 0 ? 0 : Math.ceil(items.length / query.pageSize),
    };
  }

  async sumByCash(tenantId: UUID, cashId: UUID, currency: string): Promise<Money> {
    return this.movements
      .filter((m) => m.tenantId === tenantId && m.cashId === cashId)
      .reduce((acc, m) => acc.add(m.signedAmount), Money.zero(currency));
  }
}

class InMemoryCashUnitOfWork implements ICashUnitOfWork {
  constructor(
    private readonly cash: ICashRepository,
    private readonly movements: ICashMovementRepository,
    private readonly payments: IPaymentRepository,
  ) {}

  execute<T>(work: (ctx: CashTransactionContext) => Promise<T>): Promise<T> {
    return work({ cash: this.cash, movements: this.movements, payments: this.payments });
  }
}

class FakeSaleReader implements IPaymentSaleReader {
  async getTotal(_tenantId: UUID, saleId: UUID): Promise<PaymentSaleTotal | null> {
    if (saleId === SALE_ID) {
      return { saleId, total: Money.fromDecimal(SALE_TOTAL, CURRENCY) };
    }
    return null;
  }
}

class FakePurchaseReader implements IPaymentPurchaseReader {
  async getTotal(_tenantId: UUID, purchaseId: UUID): Promise<PaymentPurchaseTotal | null> {
    if (purchaseId === PURCHASE_ID) {
      return { purchaseId, total: Money.fromDecimal(PURCHASE_TOTAL, CURRENCY) };
    }
    return null;
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
  payments: InMemoryPaymentRepository;
  cash: InMemoryCashRepository;
  movements: InMemoryCashMovementRepository;
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
        permissions: [Permission.create('cash', '*', 'read')],
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

  const payments = new InMemoryPaymentRepository();
  const cash = new InMemoryCashRepository();
  const movements = new InMemoryCashMovementRepository();
  const unitOfWork = new InMemoryCashUnitOfWork(cash, movements, payments);
  const saleReader = new FakeSaleReader();
  const purchaseReader = new FakePurchaseReader();

  // Seed a register so cash payments can move the till.
  cash.seed(Cash.create({ tenantId: TENANT_ID, name: 'Till', currency: CURRENCY }, CASH_ID));

  const container = new Container();
  container.registerValue(
    CASH_TOKENS.RecordPaymentUseCase,
    new RecordPaymentUseCase(payments, unitOfWork, cash, saleReader, purchaseReader),
  );
  container.registerValue(CASH_TOKENS.ListPaymentsUseCase, new ListPaymentsUseCase(payments));
  container.registerValue(
    CASH_TOKENS.GetPaymentStatusUseCase,
    new GetPaymentStatusUseCase(payments, saleReader, purchaseReader),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerPaymentRoutes(app, container);
  await app.ready();

  return { app, token, payments, cash, movements };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('payment routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/payments' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the write permission (record as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { saleId: SALE_ID, method: 'card', amount: '10.00' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/payments', () => {
    it('records a partial sale payment and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { saleId: SALE_ID, method: 'card', amount: '40.00' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        tenantId: TENANT_ID,
        saleId: SALE_ID,
        method: 'card',
        amount: '40.00',
      });
    });

    it('records a full purchase payment and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { purchaseId: PURCHASE_ID, method: 'transfer', amount: PURCHASE_TOTAL },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ purchaseId: PURCHASE_ID, amount: '80.00' });
    });

    it('books a cash-register movement for a cash payment tied to a register', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { saleId: SALE_ID, method: 'cash', amount: '50.00', cashId: CASH_ID },
      });
      expect(response.statusCode).toBe(201);
      // The cash sale payment credited the till (INCOME/sale movement).
      expect(ctx.movements.movements).toHaveLength(1);
      expect(ctx.movements.movements[0]).toMatchObject({ type: 'INCOME', category: 'sale' });
    });

    it('returns 422 when the payment exceeds the outstanding balance', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { saleId: SALE_ID, method: 'card', amount: '150.00' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 404 when the referenced sale does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { saleId: MISSING_ID, method: 'card', amount: '10.00' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 400 when neither sale nor purchase is linked', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { method: 'card', amount: '10.00' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 on an invalid payment method', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: authHeader(ctx.token),
        payload: { saleId: SALE_ID, method: 'bitcoin', amount: '10.00' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/payments', () => {
    it('lists payments filtered by saleId', async () => {
      ctx = await buildTestApp();
      await ctx.payments.create(
        Payment.create({
          tenantId: TENANT_ID,
          saleId: SALE_ID,
          purchaseId: null,
          method: 'card',
          amount: Money.fromDecimal('10.00', CURRENCY),
        }),
      );
      await ctx.payments.create(
        Payment.create({
          tenantId: TENANT_ID,
          saleId: null,
          purchaseId: PURCHASE_ID,
          method: 'transfer',
          amount: Money.fromDecimal('20.00', CURRENCY),
        }),
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/payments?saleId=${SALE_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].saleId).toBe(SALE_ID);
    });

    it('filters payments by method', async () => {
      ctx = await buildTestApp();
      await ctx.payments.create(
        Payment.create({
          tenantId: TENANT_ID,
          saleId: SALE_ID,
          purchaseId: null,
          method: 'cash',
          amount: Money.fromDecimal('10.00', CURRENCY),
        }),
      );
      await ctx.payments.create(
        Payment.create({
          tenantId: TENANT_ID,
          saleId: SALE_ID,
          purchaseId: null,
          method: 'card',
          amount: Money.fromDecimal('20.00', CURRENCY),
        }),
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/payments?method=card',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].method).toBe('card');
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/payments?pageSize=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/payments/status', () => {
    it('derives the partial payment status of a sale', async () => {
      ctx = await buildTestApp();
      await ctx.payments.create(
        Payment.create({
          tenantId: TENANT_ID,
          saleId: SALE_ID,
          purchaseId: null,
          method: 'card',
          amount: Money.fromDecimal('40.00', CURRENCY),
        }),
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/payments/status?saleId=${SALE_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        documentType: 'sale',
        documentId: SALE_ID,
        total: '100.00',
        paid: '40.00',
        outstanding: '60.00',
        status: 'partial',
      });
    });

    it('returns 404 when the document does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/payments/status?saleId=${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });
});
