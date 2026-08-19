import type { FeatureDenialReason } from '../errors/subscription-errors.js';

/**
 * Outcome of resolving whether a tenant may access a feature.
 *
 * A discriminated union so callers (e.g. the `requireFeature` middleware) can
 * map a denial onto the precise error type and message without re-deriving the
 * cause.
 */
export type FeatureAccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: FeatureDenialReason };

/**
 * Port for resolving tenant feature access.
 *
 * A feature is accessible to a tenant when BOTH of the following hold
 * (Requirement 12.4):
 *
 * 1. The tenant has an ACTIVE, non-expired subscription whose plan's
 *    `features` include the requested feature (Requirements 10.3, 10.4).
 * 2. No tenant-specific feature flag explicitly disables the feature. An
 *    absent flag defers to the plan; a present flag with `isEnabled = false`
 *    denies access even when the plan would allow it (Requirement 12.3, 12.4).
 *
 * Implemented by infrastructure (see the Prisma-backed implementation) and
 * consumed by the presentation layer through the DI container.
 */
export interface IFeatureAccessService {
  /**
   * Resolves the full access decision for `(tenantId, feature)`, including the
   * denial reason when access is refused.
   */
  checkFeatureAccess(tenantId: string, feature: string): Promise<FeatureAccessDecision>;

  /**
   * Convenience predicate returning `true` only when the feature is accessible.
   */
  isFeatureEnabled(tenantId: string, feature: string): Promise<boolean>;
}
