import type { IPlanRepository } from '../../domain/repositories/plan-repository.js';
import { toPlanOutput, type PlanOutput } from '../dto/subscription-dtos.js';

/**
 * Lists the active plans available for subscription (Requirement 10.1, backing
 * the public `GET /api/v1/plans` catalogue).
 *
 * Only ACTIVE plans are returned: retired plans ({@link import('../../domain/entities/plan.js').Plan.deactivate})
 * remain honoured for existing subscriptions but must not appear in the catalogue
 * a tenant chooses from. The catalogue is platform-global (not tenant-scoped),
 * so this use case takes no tenant parameter — any authenticated tenant user may
 * read it to pick or compare a plan.
 */
export class ListPlansUseCase {
  constructor(private readonly plans: IPlanRepository) {}

  async execute(): Promise<PlanOutput[]> {
    const plans = await this.plans.findActive();
    return plans.map(toPlanOutput);
  }
}
