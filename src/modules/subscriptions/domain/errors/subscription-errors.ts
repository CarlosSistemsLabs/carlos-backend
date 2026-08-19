import { BusinessRuleError, ForbiddenError } from '@domain/errors/index.js';

/**
 * Reason a feature was denied to a tenant. Drives both the thrown error type
 * and the diagnostic detail returned in the error envelope.
 */
export type FeatureDenialReason =
  | 'no_active_subscription'
  | 'subscription_expired'
  | 'plan_excludes_feature'
  | 'feature_flag_disabled';

/**
 * Raised when a tenant's active subscription plan does not grant access to a
 * requested feature, or the tenant has no usable subscription at all.
 *
 * Extends {@link ForbiddenError} (HTTP 403) because the subject is
 * authenticated but the feature is not part of their entitlement. The central
 * error handler maps it to the consistent error envelope (Requirements 10.4,
 * 12.2).
 */
export class SubscriptionRequiredError extends ForbiddenError {
  constructor(feature: string, reason: FeatureDenialReason, details?: Record<string, unknown>) {
    super(`Subscription plan does not include feature "${feature}"`, {
      feature,
      reason,
      ...details,
    });
  }
}

/**
 * Raised when a feature is explicitly disabled for a tenant via a
 * {@link FeatureFlag} override, even though the subscription plan would
 * otherwise allow it (Requirement 12.4: feature access requires BOTH plan
 * entitlement AND an enabled feature flag).
 *
 * Extends {@link ForbiddenError} (HTTP 403).
 */
export class FeatureDisabledError extends ForbiddenError {
  constructor(feature: string, details?: Record<string, unknown>) {
    super(`Feature "${feature}" is disabled for this tenant`, {
      feature,
      reason: 'feature_flag_disabled' satisfies FeatureDenialReason,
      ...details,
    });
  }
}

/**
 * Raised when a subscription's status transition is not permitted by the
 * lifecycle state machine (see `subscription-status.ts`).
 *
 * Extends {@link BusinessRuleError} (HTTP 422): the request is well-formed but
 * violates the domain invariant that governs how a subscription may move
 * between `active`, `cancelled` and `expired`.
 */
export class InvalidSubscriptionStatusTransitionError extends BusinessRuleError {
  constructor(from: string, to: string) {
    super(`Cannot transition subscription from "${from}" to "${to}"`, { from, to });
  }
}

/**
 * Raised when a tenant attempts to subscribe to a plan that is not active
 * (`Plan.isActive === false`). Inactive plans are retired from the catalogue and
 * cannot accept new subscriptions, though existing subscriptions are unaffected.
 *
 * Extends {@link BusinessRuleError} (HTTP 422).
 */
export class InactivePlanError extends BusinessRuleError {
  constructor(planId: string, details?: Record<string, unknown>) {
    super('Cannot subscribe a tenant to an inactive plan', { planId, ...details });
  }
}
