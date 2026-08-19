import { NotFoundError } from '@domain/errors/index.js';
import { Subscription } from '../../domain/entities/subscription.js';
import { InactivePlanError } from '../../domain/errors/subscription-errors.js';
import type { IPlanRepository } from '../../domain/repositories/plan-repository.js';
import type { ISubscriptionRepository } from '../../domain/repositories/subscription-repository.js';
import {
  toSubscriptionOutput,
  type CreateSubscriptionInputDto,
  type SubscriptionOutput,
} from '../dto/subscription-dtos.js';
import { computeTermEnd } from './billing-term.js';

/**
 * Subscribes a tenant to a plan (Requirements 10.2 — subscribing enables the
 * plan's feature-module access).
 *
 * Steps:
 * 1. Load the target plan. A missing plan is a 404 ({@link NotFoundError}).
 * 2. Reject subscribing to a retired (inactive) plan
 *    ({@link InactivePlanError}).
 * 3. **Supersede policy:** if the tenant already has an active subscription, it
 *    is CANCELLED before the new one is created. A tenant therefore has at most
 *    one active subscription at a time; changing plans (upgrade/downgrade)
 *    cancels the prior one and starts a fresh active subscription. This keeps
 *    the "one active subscription per tenant" assumption relied on by the
 *    feature-access read path intact rather than raising a conflict.
 * 4. Compute the term end: the caller-supplied `endDate`, or the plan's billing
 *    cycle applied to the start (monthly → +1 month, yearly → +1 year).
 * 5. Create the new subscription (start = now, status = active) and persist it.
 *
 * The clock is injectable so the start date and derived term end are
 * deterministic in tests.
 */
export class CreateSubscriptionUseCase {
  constructor(
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: CreateSubscriptionInputDto): Promise<SubscriptionOutput> {
    const plan = await this.plans.findById(input.planId);
    if (plan === null) {
      throw NotFoundError.forEntity('Plan', input.planId);
    }
    if (!plan.isActive) {
      throw new InactivePlanError(input.planId);
    }

    // Supersede any existing active subscription for the tenant.
    const existing = await this.subscriptions.findActiveByTenant(input.tenantId);
    if (existing !== null) {
      existing.cancel();
      await this.subscriptions.update(existing);
    }

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
