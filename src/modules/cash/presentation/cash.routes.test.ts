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
import { CashMovement } from '../domain/entities/cash-movement.js';
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
import type { Payment } from '../domain/entities/payment.js';
import { OpenCashRegisterUseCase } from '../application/use-cases/open-cash-register.use-case.js';
import { CloseCashRegisterUseCase } from '../application/use-cases/close-cash-register.use-case.js';
import { RecordCashMovementUseCase } from '../application/use-cases/record-cash-movement.use-case.js';
import { ListCashMovementsUseCase } from '../application/use-cases/list-cash-movements.use-case.js';
import { registerCashRoutes } from './cash.routes.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CURRENCY = 'ARS';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

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

  async create(cash: Cash): Promise<Cash> {
    this.byId.set(cash.id, cash);
    return cash;
  }

  async updateBalance(id: UUID, _balance: Money): Promise<void> {
    // The use case mutates the loaded aggregate in place before calling this,
    // so the stored reference already carries the new balance.
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
  private readonly movements: CashMovement[] = [];

  seed(movement: CashMovement): void {
    this.movements.push(movement);
  }

  async create(movement: CashMovement): Promise<CashMovement> {
    this.movements.push(movement);
    return movement;
  }

  async findMany(
    tenantId: UUID,
    query: CashMovementQuery,
  ): Promise<PaginatedResult<CashMovement>> {
    const filters = query.filters ?? {};
    let items = this.movements.filter((m) => m.tenantId === tenantId);

    if (filters.cashId !== undefined) {
      items = items.filter((m) => m.cashId === filters.cashId);
    }
    if (filters.type !== undefined) {
      items = items.filter((m) => m.type === filters.type);
    }
    if (filters.category !== undefined) {
      items = items.filter((m) => m.category === filters.category);
    }
    if (filters.from !== undefined) {
      const from = filters.from;
      items = items.filter((m) => m.date.getTime() >= from.getTime());
    }
    if (filters.to !== undefined) {
      const to = filters.to;
      items = items.filter((m) => m.date.getTime() <= to.getTime());
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

  async sumByCash(tenantId: UUID, cashId: UUID, currency: string): Promise<Money> {
    return this.movements
      .filter((m) => m.tenantId === tenantId && m.cashId === cashId)
      .reduce((acc, m) => acc.add(m.signedAmount), Money.zero(currency));
  }
}

class NoopPaymentRepository implements IPaymentRepository {
  async create(payment: Payment): Promise<Payment> {
    return payment;
  }

  async findMany(_tenantId: UUID, query: PaymentQuery): Promise<PaginatedResult<Payment>> {
    return { items: [], total: 0, page: query.page, pageSize: query.pageSize, totalPages: 0 };
  }

  async sumBySale(_tenantId: UUID, _saleId: UUID, currency: string): Promise<Money> {
    return Money.zero(currency);
  }

  async sumByPurchase(_tenantId: UUID, _purchaseId: UUID, currency: string): Promise<Money> {
    return Money.zero(currency);
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

  const cash = new InMemoryCashRepository();
  const movements = new InMemoryCashMovementRepository();
  const payments = new NoopPaymentRepository();
  const unitOfWork = new InMemoryCashUnitOfWork(cash, movements, payments);

  const container = new Container();
  container.registerValue(
    CASH_TOKENS.OpenCashRegisterUseCase,
    new OpenCashRegisterUseCase(unitOfWork),
  );
  container.registerValue(
    CASH_TOKENS.CloseCashRegisterUseCase,
    new CloseCashRegisterUseCase(unitOfWork, cash),
  );
  container.registerValue(
    CASH_TOKENS.RecordCashMovementUseCase,
    new RecordCashMovementUseCase(unitOfWork, cash),
  );
  container.registerValue(
    CASH_TOKENS.ListCashMovementsUseCase,
    new ListCashMovementsUseCase(movements),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerCashRoutes(app, container);
  await app.ready();

  return { app, token, cash, movements };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

interface SeedRegisterOverrides {
  id?: UUID;
  tenantId?: UUID;
  name?: string;
  balance?: string;
}

/** Seeds a register (optionally with a starting balance) into the repository. */
function seedRegister(ctx: TestApp, overrides: SeedRegisterOverrides = {}): Cash {
  const cash = Cash.create(
    {
      tenantId: overrides.tenantId ?? TENANT_ID,
      name: overrides.name ?? 'Front desk',
      currency: CURRENCY,
      ...(overrides.balance !== undefined
        ? { balance: Money.fromDecimal(overrides.balance, CURRENCY) }
        : {}),
    },
    overrides.id,
  );
  ctx.cash.seed(cash);
  return cash;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cash routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/cash/movements' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the write permission (open as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/open',
        headers: authHeader(ctx.token),
        payload: { name: 'Front desk' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/cash/movements',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/cash/open', () => {
    it('opens a register with no float and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/open',
        headers: authHeader(ctx.token),
        payload: { name: 'Front desk' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({ tenantId: TENANT_ID, name: 'Front desk', currency: CURRENCY });
      expect(body.balance).toBe('0.00');
    });

    it('opens a register with an opening float and books an opening movement', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/open',
        headers: authHeader(ctx.token),
        payload: { name: 'Register 2', openingBalance: '100.00' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().balance).toBe('100.00');
      const listed = await ctx.movements.findMany(TENANT_ID, { page: 1, pageSize: 10 });
      expect(listed.items.some((m) => m.category === 'opening')).toBe(true);
    });

    it('returns 400 when the name is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/open',
        headers: authHeader(ctx.token),
        payload: { openingBalance: '10.00' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/cash/close', () => {
    it('closes a register and returns the reconciliation summary (clean count)', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, {
        id: '10000000-0000-0000-0000-000000000001',
        balance: '250.00',
      });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/close',
        headers: authHeader(ctx.token),
        payload: { cashId: register.id, countedAmount: '250.00' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.expected).toBe('250.00');
      expect(body.counted).toBe('250.00');
      expect(body.difference).toBe('0.00');
      expect(body.reconciliationMovement).toBeNull();
    });

    it('reports an overage difference when the count exceeds the expected balance', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, {
        id: '10000000-0000-0000-0000-000000000002',
        balance: '200.00',
      });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/close',
        headers: authHeader(ctx.token),
        payload: { cashId: register.id, countedAmount: '230.00' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.expected).toBe('200.00');
      expect(body.counted).toBe('230.00');
      expect(body.difference).toBe('30.00');
      expect(body.reconciliationMovement).toMatchObject({ type: 'INCOME', category: 'closing' });
    });

    it('returns 404 when closing a register that does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/close',
        headers: authHeader(ctx.token),
        payload: { cashId: MISSING_ID, countedAmount: '10.00' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 for a register owned by another tenant', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, {
        id: '10000000-0000-0000-0000-000000000003',
        tenantId: OTHER_TENANT_ID,
        balance: '10.00',
      });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/close',
        headers: authHeader(ctx.token),
        payload: { cashId: register.id, countedAmount: '10.00' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/cash/movements', () => {
    it('records an INCOME movement and returns 201', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, {
        id: '20000000-0000-0000-0000-000000000001',
        balance: '50.00',
      });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/movements',
        headers: authHeader(ctx.token),
        payload: {
          cashId: register.id,
          type: 'INCOME',
          category: 'other',
          amount: '25.00',
          description: 'Top up',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        cashId: register.id,
        tenantId: TENANT_ID,
        userId: USER_ID,
        type: 'INCOME',
        category: 'other',
        amount: '25.00',
      });
    });

    it('returns 422 when an EXPENSE would overdraw the register', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, {
        id: '20000000-0000-0000-0000-000000000002',
        balance: '10.00',
      });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/movements',
        headers: authHeader(ctx.token),
        payload: { cashId: register.id, type: 'EXPENSE', category: 'other', amount: '50.00' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 404 when the register does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/movements',
        headers: authHeader(ctx.token),
        payload: { cashId: MISSING_ID, type: 'INCOME', category: 'other', amount: '10.00' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 400 on an invalid movement type', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, { id: '20000000-0000-0000-0000-000000000003' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/cash/movements',
        headers: authHeader(ctx.token),
        payload: { cashId: register.id, type: 'DEPOSIT', category: 'other', amount: '10.00' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/cash/movements', () => {
    it('lists movements scoped to the tenant', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, { id: '30000000-0000-0000-0000-000000000001' });
      ctx.movements.seed(
        CashMovement.create({
          cashId: register.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          type: 'INCOME',
          category: 'sale',
          amount: Money.fromDecimal('40.00', CURRENCY),
        }),
      );
      ctx.movements.seed(
        CashMovement.create({
          cashId: register.id,
          tenantId: OTHER_TENANT_ID,
          userId: USER_ID,
          type: 'INCOME',
          category: 'sale',
          amount: Money.fromDecimal('99.00', CURRENCY),
        }),
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/cash/movements?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toMatchObject({ total: 1, page: 1, pageSize: 10 });
      expect(body.items).toHaveLength(1);
    });

    it('filters movements by category', async () => {
      ctx = await buildTestApp();
      const register = seedRegister(ctx, { id: '30000000-0000-0000-0000-000000000002' });
      ctx.movements.seed(
        CashMovement.create({
          cashId: register.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          type: 'INCOME',
          category: 'opening',
          amount: Money.fromDecimal('10.00', CURRENCY),
        }),
      );
      ctx.movements.seed(
        CashMovement.create({
          cashId: register.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          type: 'EXPENSE',
          category: 'other',
          amount: Money.fromDecimal('5.00', CURRENCY),
        }),
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/cash/movements?category=opening',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.total).toBe(1);
      expect(body.items[0].category).toBe('opening');
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/cash/movements?page=0',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });
});
