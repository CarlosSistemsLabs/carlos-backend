import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerErrorHandler } from './error-handler.js';
import { registerFeatureFlagAuthorization } from './feature-flag.js';
import {
  PrismaFeatureAccessService,
  type FeatureAccessDecision,
  type FeatureAccessPrismaClient,
  type IFeatureAccessService,
  type SubscriptionWithPlanRow,
} from '@modules/subscriptions/index.js';

const TENANT = 'tenant-abc';

/** Builds a feature-access service stub returning a fixed decision. */
function makeService(decision: FeatureAccessDecision): IFeatureAccessService {
  return {
    checkFeatureAccess: vi.fn().mockResolvedValue(decision),
    isFeatureEnabled: vi.fn().mockResolvedValue(decision.allowed),
  };
}

/**
 * Builds an app whose `/feature` route is guarded by `requireFeature('stock')`.
 * When `authenticated` is true a preHandler seeds `request.auth` (standing in
 * for `app.authenticate`); otherwise the route runs unauthenticated.
 */
async function buildApp(
  service: IFeatureAccessService,
  authenticated: boolean,
): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  registerFeatureFlagAuthorization(app, service);

  const preHandler = authenticated
    ? [
        (request: Parameters<typeof app.authenticate>[0], _reply: unknown, done: () => void) => {
          request.auth = { tenantId: TENANT, userId: 'user-1', roleId: 'role-1' };
          done();
        },
        app.requireFeature('stock'),
      ]
    : [app.requireFeature('stock')];

  app.get('/feature', { preHandler }, () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('requireFeature middleware', () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    app = undefined;
  });

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
    }
  });

  it('allows the request when the feature is accessible', async () => {
    const service = makeService({ allowed: true });
    app = await buildApp(service, true);

    const response = await app.inject({ method: 'GET', url: '/feature' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(service.checkFeatureAccess).toHaveBeenCalledWith(TENANT, 'stock');
  });

  it('returns 401 when the request is unauthenticated', async () => {
    const service = makeService({ allowed: true });
    app = await buildApp(service, false);

    const response = await app.inject({ method: 'GET', url: '/feature' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe('UNAUTHORIZED');
    expect(service.checkFeatureAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when the plan does not include the feature', async () => {
    const service = makeService({ allowed: false, reason: 'plan_excludes_feature' });
    app = await buildApp(service, true);

    const response = await app.inject({ method: 'GET', url: '/feature' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe('FORBIDDEN');
  });

  it('returns 403 when there is no active subscription', async () => {
    const service = makeService({ allowed: false, reason: 'no_active_subscription' });
    app = await buildApp(service, true);

    const response = await app.inject({ method: 'GET', url: '/feature' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe('FORBIDDEN');
  });

  it('returns 403 when the subscription is expired', async () => {
    const service = makeService({ allowed: false, reason: 'subscription_expired' });
    app = await buildApp(service, true);

    const response = await app.inject({ method: 'GET', url: '/feature' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe('FORBIDDEN');
  });

  it('returns 403 when a feature flag explicitly disables the feature', async () => {
    const service = makeService({ allowed: false, reason: 'feature_flag_disabled' });
    app = await buildApp(service, true);

    const response = await app.inject({ method: 'GET', url: '/feature' });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error_code).toBe('FORBIDDEN');
    expect(body.message).toContain('disabled');
  });

  it('enforces subscription expiry in real time — the immediate next request after expiry is denied (Requirement 10.6)', async () => {
    // Wire the REAL feature-access service over a fake data store with a
    // mutable clock. The subscription's term ends at `expiry`; nothing is
    // cached, so the guard re-evaluates the store on every request and denies
    // the very next request once the clock passes `expiry`.
    const expiry = new Date('2025-01-15T12:00:00.000Z');
    const subscription: SubscriptionWithPlanRow = {
      id: 'sub-1',
      tenantId: TENANT,
      planId: 'plan-business',
      status: 'active',
      startDate: new Date('2025-01-01T00:00:00.000Z'),
      endDate: expiry,
      plan: { id: 'plan-business', name: 'business', features: ['stock'], isActive: true },
    };
    const prisma: FeatureAccessPrismaClient = {
      subscription: { findFirst: vi.fn().mockResolvedValue(subscription) },
      featureFlag: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    let clock = new Date(expiry.getTime() - 1000); // one second before expiry
    const service = new PrismaFeatureAccessService(prisma, () => clock);
    app = await buildApp(service, true);

    const allowed = await app.inject({ method: 'GET', url: '/feature' });
    expect(allowed.statusCode).toBe(200);

    // Advance the clock past the term end. No cache means the next request sees
    // the expiry immediately (well within the 1-hour bound).
    clock = new Date(expiry.getTime() + 1000);
    const denied = await app.inject({ method: 'GET', url: '/feature' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error_code).toBe('FORBIDDEN');
  });
});
