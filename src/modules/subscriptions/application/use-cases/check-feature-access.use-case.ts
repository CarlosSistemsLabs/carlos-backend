import type { IFeatureAccessService } from '../../domain/services/feature-access-service.js';
import {
  type CheckFeatureAccessInputDto,
  type FeatureAccessOutput,
} from '../dto/subscription-dtos.js';

/**
 * Resolves whether a tenant may access a feature (Requirements 10.2, 10.4).
 *
 * **Reconciliation with {@link IFeatureAccessService}.** Feature-access
 * resolution — combining the tenant's active subscription plan (Requirement 10)
 * with per-tenant feature-flag overrides (Requirement 12) — already lives in the
 * {@link IFeatureAccessService} domain service, which the `requireFeature`
 * middleware consumes directly on the hot path. This use case is a thin
 * application wrapper that delegates to that same service rather than
 * re-deriving the logic, so there is a single source of truth. It exists to give
 * the (future) subscription management endpoints a use-case-shaped entry point
 * that returns a serialisable {@link FeatureAccessOutput} instead of the
 * internal decision union.
 */
export class CheckFeatureAccessUseCase {
  constructor(private readonly featureAccess: IFeatureAccessService) {}

  async execute(input: CheckFeatureAccessInputDto): Promise<FeatureAccessOutput> {
    const decision = await this.featureAccess.checkFeatureAccess(input.tenantId, input.feature);
    if (decision.allowed) {
      return { tenantId: input.tenantId, feature: input.feature, allowed: true };
    }
    return {
      tenantId: input.tenantId,
      feature: input.feature,
      allowed: false,
      reason: decision.reason,
    };
  }
}
