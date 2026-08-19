import { NotFoundError } from '@domain/errors/index.js';
import { Subscription } from '../../domain/entities/subscription.js';
import { InactivePlanError } from '../../domain/errors/subscription-errors.js';
import type { IPlanRepository } from '../../domain/repositories/plan-repository.js';
import type { ISubscriptionRepository } from '../../domain/repositories/subscription-repository.js';
import {
  toSubscriptionOutput,
  type SubscriptionOutput,
  type UpgradeSubscriptionInputDto,
} from '../dto/subscription-dtos.js';
import { computeTermEnd } from './billing-term.js';

/**
 * Switches a tenant to a different plan (upgrade or downgrade), backing
 * `PUT /api/v1/subscriptions/:id/upgrade` (Requirement 10.2).
 *
 * **Ownership check.** The `:id` subscription is loaded tenant-scoped
 * ({@link ISubscriptionRepository.findById}); a missing id — or one belonging to
 * another tenant — is a 404 ({@link NotFoundError}), so a caller can never
 * mutate another tenant's subscription (Requirement 1.5).
 *
 * **Supersede policy (history-preserving).** Rather than mutating the plan on
 * the existing row, the change reuses the same supersede path as
 * {@link import('./create-subscription.use-case.js').CreateSubscriptionUseCase}:
 * the tenant's current active subscription is CANCELLED and a brand-new active
 * subscription is created on the target plan. This keeps the "one active
 * subscription per tenant" invariant that the feature-access read path relies
 * on, and preserves the full subscription history (the prior term remains
 * visible as a cancelled record) instead of overwriting it.
 *
 * Steps:
 * 1. Load and validate ownership of the `:id` subscription (404 when absent).
 * 2. Load the target plan (404 when absent) and reject a retired plan (422,
 *    {@link InactivePlanError}).
 * 3. Cancel the tenant's current active subscription, if any.
 * 4. Create + persist a new active subscription on the target plan, deriving the
 *    term end from the caller-supplied `endDate` or the plan's billing cycle.
 *
 * The clock is injectable so the new start date and derived term end are
 * deterministic in tests.
 */
export class UpgradeSubscriptionUseCase {
  constructor(
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: UpgradeSubscriptionInputDto): Promise<SubscriptionOutput> {
    // 1. Ownership: the target subscription must exist within the caller's tenant.
    const current = await this.subscriptions.findById(input.tenantId, input.subscriptionId);
    if (current === null) {
      throw NotFoundError.forEntity('Subscription', input.subscriptionId);
    }

    // 2. Target plan must exist and be available for subscription.
    const plan = await this.plans.findById(input.planId);
    if (plan === null) {
      throw NotFoundError.forEntity('Plan', input.planId);
    }
    if (!plan.isActive) {
      throw new InactivePlanError(input.planId);
    }

    // 3. Supersede the tenant's current active subscription (may be `current`).
    const active = await this.subscriptions.findActiveByTenant(input.tenantId);
    if (active !== null) {
      active.cancel();
      await this.subscriptions.update(active);
    }

    // 4. Create the new active subscription on the target plan.
    const startDate = this.now();
    const endDate = input.endDate ?? computeTermEnd(startDate, plan.billingCycle);
    const subscription = Subscription.create({
      tenantId: input.tenantId,
      planId: plan.id,
      startDate,
      endDate,
      ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew } : {}),
    });

    const persisted = await this.subscriptions.create(subscription);
    return toSubscriptionOutput(persisted);
  }
}
