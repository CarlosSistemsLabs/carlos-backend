import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../domain/services/feature-access-service.js';

/** Persistence row shape for the `Plan` model (structural subset). */
export interface PlanRow {
  id: string;
  name: string;
  /** `Plan.features` JSON column: an array of feature-name strings. */
  features: unknown;
  isActive: boolean;
}

/**
 * Persistence row shape for the `Subscription` model with its `Plan` eagerly
 * loaded. A structural subset of the generated Prisma type so the service stays
 * explicit and trivially testable with a fake delegate.
 */
export interface SubscriptionWithPlanRow {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  plan: PlanRow;
}

/** Persistence row shape for the `FeatureFlag` model (structural subset). */
export interface FeatureFlagRow {
  isEnabled: boolean;
}

/** Minimal `subscription` delegate surface used by the service. */
export interface SubscriptionModelDelegate {
  findFirst(args: {
    where: Record<string, unknown>;
    include: { plan: true };
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<SubscriptionWithPlanRow | null>;
}

/** Minimal `featureFlag` delegate surface used by the service. */
export interface FeatureFlagModelDelegate {
  findUnique(args: {
    where: { tenantId_feature: { tenantId: string; feature: string } };
  }): Promise<FeatureFlagRow | null>;
}

/** A Prisma-like client exposing the `subscription` and `featureFlag` delegates. */
export interface FeatureAccessPrismaClient {
  subscription: SubscriptionModelDelegate;
  featureFlag: FeatureFlagModelDelegate;
}

/** Normalises the `Plan.features` JSON value into a list of feature names. */
function parsePlanFeatures(features: unknown): string[] {
  if (!Array.isArray(features)) {
    return [];
  }
  return features.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Prisma-backed {@link IFeatureAccessService}.
 *
 * **Client choice:** this service is bound (in the composition root) to the
 * UNEXTENDED Prisma client and scopes every query by `tenantId` explicitly.
 * The `requireFeature` guard runs as a route-level `preHandler`, after the
 * global tenant-context hook has already executed but before the request's
 * tenant id has been propagated into the async context, so the automatic
 * tenant filter of the extended client cannot be relied upon here. Passing the
 * tenant id explicitly (sourced from the verified `request.auth`) keeps tenant
 * isolation auditable, mirroring the auth/authorization repositories
 * (Requirement 1.5). `Plan` is a platform-global catalogue and is read via the
 * eager `include`.
 *
 * Access resolution (Requirement 12.4 — verify BOTH plan AND feature flag):
 *
 * 1. Load the tenant's ACTIVE subscription with its plan. None → denied
 *    (`no_active_subscription`).
 * 2. If the subscription has an `endDate` at or before `now` → denied
 *    (`subscription_expired`). The `endDate` boundary is EXCLUSIVE (`<= now`),
 *    matching {@link Subscription.isActive}/`isExpired` in the aggregate: a row
 *    may still carry `status = 'active'` after its term lapses (before a
 *    background job flips the status), yet access is refused the instant the
 *    term ends (Requirements 10.4, 10.6).
 * 3. If the plan is inactive or its `features` do not include the requested
 *    feature → denied (`plan_excludes_feature`) (Requirements 10.3, 10.4).
 * 4. Load the tenant's feature flag for the feature. A present flag with
 *    `isEnabled = false` → denied (`feature_flag_disabled`). An absent flag, or
 *    a flag with `isEnabled = true`, defers to/confirms the plan grant
 *    (Requirements 12.3, 12.4).
 *
 * **Real-time enforcement (Requirement 10.6 — restrict paid features within 1
 * hour of expiry):** the decision is computed from the data store on EVERY
 * request; feature-access results are NOT cached. The `requireFeature`
 * `preHandler` therefore observes an expired subscription on the very next
 * request after its `endDate` passes (latency ≈ one request, far inside the
 * 1-hour bound). Because nothing is cached there is no TTL to bound and no
 * cache to invalidate on subscription changes (e.g. from
 * `CreateSubscriptionUseCase`); enforcement cannot go stale.
 */
export class PrismaFeatureAccessService implements IFeatureAccessService {
  constructor(
    private readonly prisma: FeatureAccessPrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async checkFeatureAccess(tenantId: string, feature: string): Promise<FeatureAccessDecision> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, status: 'active' },
      include: { plan: true },
      orderBy: { startDate: 'desc' },
    });

    if (subscription === null) {
      return { allowed: false, reason: 'no_active_subscription' };
    }

    if (subscription.endDate !== null && subscription.endDate.getTime() <= this.now().getTime()) {
      return { allowed: false, reason: 'subscription_expired' };
    }

    const planFeatures = parsePlanFeatures(subscription.plan.features);
    if (!subscription.plan.isActive || !planFeatures.includes(feature)) {
      return { allowed: false, reason: 'plan_excludes_feature' };
    }

    const flag = await this.prisma.featureFlag.findUnique({
      where: { tenantId_feature: { tenantId, feature } },
    });
    if (flag !== null && !flag.isEnabled) {
      return { allowed: false, reason: 'feature_flag_disabled' };
    }

    return { allowed: true };
  }

  async isFeatureEnabled(tenantId: string, feature: string): Promise<boolean> {
    const decision = await this.checkFeatureAccess(tenantId, feature);
    return decision.allowed;
  }
}
