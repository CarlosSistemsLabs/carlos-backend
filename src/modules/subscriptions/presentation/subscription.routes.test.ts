import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, SUBSCRIPTION_TOKENS } from '@infrastructure/di/index.js';
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
} from '../domain/services/feature-access-service.js';
import { Plan } from '../domain/entities/plan.js';
import { Subscription } from '../domain/entities/subscription.js';
import type { IPlanRepository } from '../domain/repositories/plan-repository.js';
import type { ISubscriptionRepository } from '../domain/repositories/subscription-repository.js';
import { CreateSubscriptionUseCase } from '../application/use-cases/create-subscription.use-case.js';
import { GetCurrentSubscriptionUseCase } from '../application/use-cases/get-current-subscription.use-case.js';
import { UpgradeSubscriptionUseCase } from '../application/use-cases/upgrade-subscription.use-case.js';
import { ListPlansUseCase } from '../application/use-cases/list-plans.use-case.js';
import { registerSubscriptionRoutes } from './subscription.routes.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const STARTER_PLAN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const BUSINESS_PLAN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const RETIRED_PLAN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
const CURRENCY = 'USD';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemoryPlanRepository implements IPlanRepository {
  private readonly byId = new Map<UUID, Plan>();

  seed(plan: Plan): void {
    this.byId.set(plan.id, plan);
  }

  async findById(id: UUID): Promise<Plan | null> {
    return this.byId.get(id) ?? null;
  }

  async findByName(name: string): Promise<Plan | null> {
    for (const plan of this.byId.values()) {
      if (plan.name === name) {
        return plan;
      }
    }
    return null;
  }

  async findActive(): Promise<Plan[]> {
    return [...this.byId.values()].filter((p) => p.isActive);
  }

  async findAll(): Promise<Plan[]> {
    return [...this.byId.values()];
  }

  async create(plan: Plan): Promise<Plan> {
    this.byId.set(plan.id, plan);
    return plan;
  }

  async update(plan: Plan): Promise<Plan> {
    this.byId.set(plan.id, plan);
    return plan;
  }
}

class InMemorySubscriptionRepository implements ISubscriptionRepository {
  private readonly byId = new Map<UUID, Subscription>();

  seed(subscription: Subscription): void {
    this.byId.set(subscription.id, subscription);
  }

  async findById(tenantId: UUID, id: UUID): Promise<Subscription | null> {
    const found = this.byId.get(id);
    return found !== undefined && found.tenantId === tenantId ? found : null;
  }

  async findActiveByTenant(tenantId: UUID): Promise<Subscription | null> {
    const active = [...this.byId.values()]
      .filter((s) => s.tenantId === tenantId && s.status === 'active')
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
    return active[0] ?? null;
  }

  async findByTenant(tenantId: UUID): Promise<Subscription[]> {
    return [...this.byId.values()]
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  }

  async create(subscription: Subscription): Promise<Subscription> {
    this.byId.set(subscription.id, subscription);
    return subscription;
  }

  async update(subscription: Subscription): Promise<Subscription> {
    this.byId.set(subscription.id, subscription);
    return subscription;
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

/** Denies every feature — models a tenant with no active / an expired subscription. */
class DenyAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: false, reason: 'no_active_subscription' };
  }

  async isFeatureEnabled(): Promise<boolean> {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

interface TestAppOptions {
  /** When false, the caller is a non-admin Reader role (no admin RBAC grant). */
  admin?: boolean;
  /** When false, every feature is denied (expired-tenant scenario). */
  featureAllowed?: boolean;
}

interface TestApp {
  app: FastifyInstance;
  token: string;
  plans: InMemoryPlanRepository;
  subscriptions: InMemorySubscriptionRepository;
}

function seedPlan(
  repo: InMemoryPlanRepository,
  id: UUID,
  name: string,
  isActive = true,
): Plan {
  const plan = Plan.create(
    {
      name,
      displayName: name,
      price: Money.fromDecimal('29.00', CURRENCY),
      billingCycle: 'monthly',
      features: ['sales'],
      isActive,
    },
    id,
  );
  repo.seed(plan);
  return plan;
}

async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const admin = options.admin ?? true;
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
  // A non-admin role with broad read grants but NO administration permission.
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

  const roleId = admin ? ADMIN_ROLE_ID : READER_ROLE_ID;
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

  const plans = new InMemoryPlanRepository();
  seedPlan(plans, STARTER_PLAN_ID, 'starter');
  seedPlan(plans, BUSINESS_PLAN_ID, 'business');
  seedPlan(plans, RETIRED_PLAN_ID, 'legacy', false);

  const subscriptions = new InMemorySubscriptionRepository();

  const container = new Container();
  container.registerValue(
    SUBSCRIPTION_TOKENS.CreateSubscriptionUseCase,
    new CreateSubscriptionUseCase(subscriptions, plans),
  );
  container.registerValue(
    SUBSCRIPTION_TOKENS.GetCurrentSubscriptionUseCase,
    new GetCurrentSubscriptionUseCase(subscriptions, plans),
  );
  container.registerValue(
    SUBSCRIPTION_TOKENS.UpgradeSubscriptionUseCase,
    new UpgradeSubscriptionUseCase(subscriptions, plans),
  );
  container.registerValue(SUBSCRIPTION_TOKENS.ListPlansUseCase, new ListPlansUseCase(plans));

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerSubscriptionRoutes(app, container);
  await app.ready();

  return { app, token, plans, subscriptions };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Seeds an active subscription for the caller's tenant on the given plan. */
function seedActiveSubscription(ctx: TestApp, id: UUID, planId: UUID): Subscription {
  const subscription = Subscription.create(
    {
      tenantId: TENANT_ID,
      planId,
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: new Date('2999-01-01T00:00:00.000Z'),
    },
    id,
  );
  ctx.subscriptions.seed(subscription);
  return subscription;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('subscription routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated (create)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        payload: { planId: STARTER_PLAN_ID },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when unauthenticated (list plans)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/plans' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when a non-admin tries to create a subscription', async () => {
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: authHeader(ctx.token),
        payload: { planId: STARTER_PLAN_ID },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when a non-admin tries to upgrade a subscription', async () => {
      ctx = await buildTestApp({ admin: false });
      const sub = seedActiveSubscription(ctx, '55555555-5555-5555-5555-555555555555', STARTER_PLAN_ID);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/subscriptions/${sub.id}/upgrade`,
        headers: authHeader(ctx.token),
        payload: { planId: BUSINESS_PLAN_ID },
      });
      expect(response.statusCode).toBe(403);
    });

    it('allows a non-admin to list plans (200)', async () => {
      ctx = await buildTestApp({ admin: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/plans',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
    });

    it('allows a non-admin to read the current subscription (200)', async () => {
      ctx = await buildTestApp({ admin: false });
      seedActiveSubscription(ctx, '55555555-5555-5555-5555-555555555556', STARTER_PLAN_ID);
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions/current',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/subscriptions', () => {
    it('creates a subscription and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: authHeader(ctx.token),
        payload: { planId: STARTER_PLAN_ID },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        tenantId: TENANT_ID,
        planId: STARTER_PLAN_ID,
        status: 'active',
      });
    });

    it('returns 404 when the plan does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: authHeader(ctx.token),
        payload: { planId: MISSING_ID },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 422 when subscribing to an inactive (retired) plan', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: authHeader(ctx.token),
        payload: { planId: RETIRED_PLAN_ID },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 400 on an invalid body (missing planId)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: authHeader(ctx.token),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/subscriptions/current', () => {
    it('returns the current subscription joined with its plan (200)', async () => {
      ctx = await buildTestApp();
      seedActiveSubscription(ctx, '55555555-5555-5555-5555-555555555557', STARTER_PLAN_ID);
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions/current',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.subscription).toMatchObject({ tenantId: TENANT_ID, planId: STARTER_PLAN_ID });
      expect(body.plan).toMatchObject({ id: STARTER_PLAN_ID, name: 'starter' });
      expect(body.currentStatus).toBe('active');
    });

    it('returns 404 when the tenant has no active subscription', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions/current',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/v1/subscriptions/:id/upgrade', () => {
    it('upgrades to a new plan and returns 200 (supersede: old cancelled, new active)', async () => {
      ctx = await buildTestApp();
      const old = seedActiveSubscription(ctx, '55555555-5555-5555-5555-555555555558', STARTER_PLAN_ID);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/subscriptions/${old.id}/upgrade`,
        headers: authHeader(ctx.token),
        payload: { planId: BUSINESS_PLAN_ID },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ tenantId: TENANT_ID, planId: BUSINESS_PLAN_ID, status: 'active' });
      // History preserved: the prior subscription is now cancelled.
      const prior = await ctx.subscriptions.findById(TENANT_ID, old.id);
      expect(prior?.status).toBe('cancelled');
    });

    it('returns 404 when the subscription does not exist for the tenant', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/subscriptions/${MISSING_ID}/upgrade`,
        headers: authHeader(ctx.token),
        payload: { planId: BUSINESS_PLAN_ID },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 404 when the subscription belongs to another tenant', async () => {
      ctx = await buildTestApp();
      const foreign = Subscription.create(
        {
          tenantId: OTHER_TENANT_ID,
          planId: STARTER_PLAN_ID,
          startDate: new Date('2024-01-01T00:00:00.000Z'),
          endDate: new Date('2999-01-01T00:00:00.000Z'),
        },
        '66666666-6666-6666-6666-666666666666',
      );
      ctx.subscriptions.seed(foreign);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/subscriptions/${foreign.id}/upgrade`,
        headers: authHeader(ctx.token),
        payload: { planId: BUSINESS_PLAN_ID },
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when the target plan does not exist', async () => {
      ctx = await buildTestApp();
      const sub = seedActiveSubscription(ctx, '55555555-5555-5555-5555-555555555559', STARTER_PLAN_ID);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/subscriptions/${sub.id}/upgrade`,
        headers: authHeader(ctx.token),
        payload: { planId: MISSING_ID },
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 400 on an invalid body (missing planId)', async () => {
      ctx = await buildTestApp();
      const sub = seedActiveSubscription(ctx, '55555555-5555-5555-5555-55555555555a', STARTER_PLAN_ID);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/subscriptions/${sub.id}/upgrade`,
        headers: authHeader(ctx.token),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/plans', () => {
    it('lists only the active plans (200)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/plans',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ id: string; isActive: boolean }>;
      const ids = body.map((p) => p.id);
      expect(ids).toContain(STARTER_PLAN_ID);
      expect(ids).toContain(BUSINESS_PLAN_ID);
      expect(ids).not.toContain(RETIRED_PLAN_ID);
      expect(body.every((p) => p.isActive)).toBe(true);
    });
  });

  describe('requireFeature exemption (expired/absent subscription can still re-subscribe)', () => {
    it('creates a subscription even when every feature is denied (201)', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: authHeader(ctx.token),
        payload: { planId: STARTER_PLAN_ID },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().planId).toBe(STARTER_PLAN_ID);
    });

    it('upgrades a subscription even when every feature is denied (200)', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const sub = seedActiveSubscription(ctx, '55555555-5555-5555-5555-55555555555b', STARTER_PLAN_ID);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/subscriptions/${sub.id}/upgrade`,
        headers: authHeader(ctx.token),
        payload: { planId: BUSINESS_PLAN_ID },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().planId).toBe(BUSINESS_PLAN_ID);
    });
  });
});
