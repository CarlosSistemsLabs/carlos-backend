import type { UUID } from '@shared/types/index.js';
import type { Plan } from '../entities/plan.js';

/**
 * Persistence abstraction for {@link Plan}s (Requirement 10.1, 10.5).
 *
 * **Global catalogue — not tenant-scoped.** Plans belong to the platform, not
 * to any tenant, so this port has no tenant parameter and its Prisma
 * implementation is bound to the UNEXTENDED `systemPrisma` client (the automatic
 * tenant filter would have no tenant to inject). Plans are identified by their
 * unique `name` as well as their id, so the seed use case can upsert
 * idempotently.
 *
 * The domain depends only on this port (Clean Architecture, Requirement 3.2).
 */
export interface IPlanRepository {
  /** Returns the plan with the given id, or `null` when none exists. */
  findById(id: UUID): Promise<Plan | null>;

  /** Returns the plan with the given unique name, or `null` when none exists. */
  findByName(name: string): Promise<Plan | null>;

  /** Returns every active plan (available for new subscriptions). */
  findActive(): Promise<Plan[]>;

  /** Returns every plan in the catalogue, active or not. */
  findAll(): Promise<Plan[]>;

  /** Persists a new plan. */
  create(plan: Plan): Promise<Plan>;

  /** Persists changes to an existing plan (price, features, active flag, …). */
  update(plan: Plan): Promise<Plan>;
}
