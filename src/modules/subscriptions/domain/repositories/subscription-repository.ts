import type { UUID } from '@shared/types/index.js';
import type { Subscription } from '../entities/subscription.js';

/**
 * Persistence abstraction for {@link Subscription}s (Requirement 10.2).
 *
 * **Tenant-scoped.** Subscriptions belong to a tenant, so the Prisma
 * implementation is bound to the tenant-aware `tenantPrisma` client and each
 * method also passes `tenantId` explicitly for defence-in-depth
 * (Requirement 1.5).
 *
 * **Relationship to the feature-access read path.** The hot-path
 * {@link import('../services/feature-access-service.js').IFeatureAccessService}
 * reads a tenant's active subscription joined with its plan directly (an
 * optimised single query). This repository is the *management* surface used by
 * the subscription use cases; {@link findActiveByTenant} deliberately mirrors
 * the same "one active subscription per tenant" assumption so the two views
 * stay consistent.
 */
export interface ISubscriptionRepository {
  /** Returns the subscription with the given id (tenant-scoped), or `null`. */
  findById(tenantId: UUID, id: UUID): Promise<Subscription | null>;

  /**
   * Returns the tenant's current active subscription (most recent by
   * `startDate` when more than one exists), or `null` when the tenant has none.
   */
  findActiveByTenant(tenantId: UUID): Promise<Subscription | null>;

  /** Returns every subscription for the tenant, newest first. */
  findByTenant(tenantId: UUID): Promise<Subscription[]>;

  /** Persists a new subscription. */
  create(subscription: Subscription): Promise<Subscription>;

  /** Persists changes to an existing subscription (status, term, autoRenew). */
  update(subscription: Subscription): Promise<Subscription>;
}
