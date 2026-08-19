import { describe, it, expect, vi } from 'vitest';
import {
  PrismaFeatureAccessService,
  type FeatureAccessPrismaClient,
  type FeatureFlagRow,
  type SubscriptionWithPlanRow,
} from './prisma-feature-access-service.js';

const NOW = new Date('2025-01-15T12:00:00.000Z');
const TENANT = 'tenant-abc';

function makeSubscription(
  overrides: Partial<SubscriptionWithPlanRow> = {},
): SubscriptionWithPlanRow {
  return {
    id: 'sub-1',
    tenantId: TENANT,
    planId: 'plan-business',
    status: 'active',
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    endDate: null,
    plan: {
      id: 'plan-business',
      name: 'business',
      features: ['sales', 'customers', 'stock', 'cash', 'reports'],
      isActive: true,
    },
    ...overrides,
  };
}

function makeClient(options: {
  subscription: SubscriptionWithPlanRow | null;
  flag?: FeatureFlagRow | null;
}): {
  client: FeatureAccessPrismaClient;
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn().mockResolvedValue(options.subscription);
  const findUnique = vi.fn().mockResolvedValue(options.flag ?? null);
  const client: FeatureAccessPrismaClient = {
    subscription: { findFirst },
    featureFlag: { findUnique },
  };
  return { client, findFirst, findUnique };
}

function buildService(client: FeatureAccessPrismaClient): PrismaFeatureAccessService {
  return new PrismaFeatureAccessService(client, () => NOW);
}

describe('PrismaFeatureAccessService', () => {
  it('allows when the active plan includes the feature and no flag exists', async () => {
    const { client, findFirst, findUnique } = makeClient({ subscription: makeSubscription() });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: true });
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, status: 'active' },
      include: { plan: true },
      orderBy: { startDate: 'desc' },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_feature: { tenantId: TENANT, feature: 'stock' } },
    });
  });

  it('allows when the active plan includes the feature and the flag is enabled', async () => {
    const { client } = makeClient({
      subscription: makeSubscription(),
      flag: { isEnabled: true },
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: true });
  });

  it('denies with no_active_subscription when the tenant has no active subscription', async () => {
    const { client, findUnique } = makeClient({ subscription: null });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'no_active_subscription' });
    // Short-circuits before consulting the feature flag.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('denies with subscription_expired when the endDate has passed', async () => {
    const { client } = makeClient({
      subscription: makeSubscription({ endDate: new Date('2025-01-10T00:00:00.000Z') }),
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'subscription_expired' });
  });

  it('denies with subscription_expired when the endDate equals now (exclusive boundary)', async () => {
    // Matches Subscription.isActive/isExpired: the endDate boundary is
    // exclusive, so a subscription whose term ends exactly at `now` is expired.
    const { client } = makeClient({
      subscription: makeSubscription({ endDate: new Date(NOW.getTime()) }),
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'subscription_expired' });
  });

  it('denies an active-status subscription whose endDate has already passed', async () => {
    // Key expiration case: the row still reads status='active' (a background
    // job has not yet flipped it) but its term lapsed — access is refused.
    const { client } = makeClient({
      subscription: makeSubscription({
        status: 'active',
        endDate: new Date('2025-01-14T11:59:59.999Z'),
      }),
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'subscription_expired' });
  });

  it('allows when the endDate is still in the future', async () => {
    const { client } = makeClient({
      subscription: makeSubscription({ endDate: new Date('2025-02-01T00:00:00.000Z') }),
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: true });
  });

  it('denies with plan_excludes_feature when the plan does not include the feature', async () => {
    const { client } = makeClient({
      subscription: makeSubscription({
        plan: { id: 'plan-starter', name: 'starter', features: ['sales', 'customers'], isActive: true },
      }),
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'plan_excludes_feature' });
  });

  it('denies with plan_excludes_feature when the plan is inactive', async () => {
    const { client } = makeClient({
      subscription: makeSubscription({
        plan: {
          id: 'plan-business',
          name: 'business',
          features: ['sales', 'customers', 'stock'],
          isActive: false,
        },
      }),
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'plan_excludes_feature' });
  });

  it('denies with feature_flag_disabled when a flag explicitly disables the feature', async () => {
    const { client } = makeClient({
      subscription: makeSubscription(),
      flag: { isEnabled: false },
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'feature_flag_disabled' });
  });

  it('tolerates a malformed (non-array) plan.features by denying access', async () => {
    const { client } = makeClient({
      subscription: makeSubscription({
        plan: { id: 'p', name: 'business', features: null, isActive: true },
      }),
    });
    const service = buildService(client);

    const decision = await service.checkFeatureAccess(TENANT, 'stock');

    expect(decision).toEqual({ allowed: false, reason: 'plan_excludes_feature' });
  });

  it('isFeatureEnabled reflects the access decision as a boolean', async () => {
    const allowed = buildService(makeClient({ subscription: makeSubscription() }).client);
    const denied = buildService(makeClient({ subscription: null }).client);

    await expect(allowed.isFeatureEnabled(TENANT, 'stock')).resolves.toBe(true);
    await expect(denied.isFeatureEnabled(TENANT, 'stock')).resolves.toBe(false);
  });
});
