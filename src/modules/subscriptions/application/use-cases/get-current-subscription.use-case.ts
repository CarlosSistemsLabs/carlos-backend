import { NotFoundError } from '@domain/errors/index.js';
import type { IPlanRepository } from '../../domain/repositories/plan-repository.js';
import type { ISubscriptionRepository } from '../../domain/repositories/subscription-repository.js';
import {
  toCurrentSubscriptionOutput,
  type CurrentSubscriptionOutput,
  type GetCurrentSubscriptionInputDto,
} from '../dto/subscription-dtos.js';

/**
 * Resolves the caller tenant's current active subscription joined with its plan
 * (Requirement 10.2, backing `GET /api/v1/subscriptions/current`).
 *
 * Steps:
 * 1. Load the tenant's active subscription via
 *    {@link ISubscriptionRepository.findActiveByTenant}. When the tenant has no
 *    active subscription the endpoint has nothing to return, surfaced as a 404
 *    ({@link NotFoundError}).
 * 2. Resolve the subscription's plan from the GLOBAL plan catalogue
 *    ({@link IPlanRepository.findById}). A dangling plan reference is a data
 *    integrity fault and likewise surfaces as a 404.
 * 3. Project the pair, computing the temporal status (`active` while the term is
 *    live, else `expired`) from the injectable clock so the "one active
 *    subscription per tenant" view stays consistent with the feature-access
 *    read path even before a background job flips a lapsed subscription's status
 *    (Requirement 10.6).
 */
export class GetCurrentSubscriptionUseCase {
  constructor(
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: GetCurrentSubscriptionInputDto): Promise<CurrentSubscriptionOutput> {
    const subscription = await this.subscriptions.findActiveByTenant(input.tenantId);
    if (subscription === null) {
      throw NotFoundError.forEntity('Subscription', input.tenantId);
    }

    const plan = await this.plans.findById(subscription.planId);
    if (plan === null) {
      throw NotFoundError.forEntity('Plan', subscription.planId);
    }

    return toCurrentSubscriptionOutput(subscription, plan, this.now());
  }
}
