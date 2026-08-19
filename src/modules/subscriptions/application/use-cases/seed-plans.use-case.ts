import { Money } from '@shared/value-objects/money.js';
import { Plan } from '../../domain/entities/plan.js';
import type { IPlanRepository } from '../../domain/repositories/plan-repository.js';
import {
  DEFAULT_PLAN_CURRENCY,
  PLAN_SEED_DEFINITIONS,
  toPlanOutput,
  type PlanOutput,
} from '../dto/subscription-dtos.js';

/**
 * Seeds the initial plan catalogue — Starter, Business, Enterprise
 * (Requirement 10.1) — with the feature sets from the plan → feature matrix
 * (Requirement 10.3).
 *
 * This is a **global** operation: plans are platform-wide, not tenant-scoped, so
 * the use case is driven against the `systemPrisma`-backed
 * {@link IPlanRepository}. It is **idempotent** — a plan whose `name` already
 * exists is left untouched and returned as-is, so running the seed repeatedly
 * (bootstrap, migrations, dev scripts) never creates duplicates or raises a
 * conflict.
 */
export class SeedPlansUseCase {
  constructor(private readonly plans: IPlanRepository) {}

  async execute(): Promise<PlanOutput[]> {
    const results: PlanOutput[] = [];

    for (const definition of PLAN_SEED_DEFINITIONS) {
      const existing = await this.plans.findByName(definition.name);
      if (existing !== null) {
        results.push(toPlanOutput(existing));
        continue;
      }

      const plan = Plan.create({
        name: definition.name,
        displayName: definition.displayName,
        description: definition.description,
        price: Money.fromDecimal(definition.price, DEFAULT_PLAN_CURRENCY),
        billingCycle: definition.billingCycle,
        features: definition.features,
      });

      const saved = await this.plans.create(plan);
      results.push(toPlanOutput(saved));
    }

    return results;
  }
}
