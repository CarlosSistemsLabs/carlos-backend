import type { Nullable, UUID } from '@shared/types/index.js';
import type { Plan } from '../../domain/entities/plan.js';
import type { Subscription } from '../../domain/entities/subscription.js';
import type { FeatureDenialReason } from '../../domain/errors/subscription-errors.js';
import type { BillingCycle } from '../../domain/value-objects/billing-cycle.js';
import type { SubscriptionStatus } from '../../domain/value-objects/subscription-status.js';
import {
  PLAN_FEATURE_MATRIX,
  PLAN_NAMES,
  type FeatureName,
  type PlanName,
} from '../../domain/constants/plan-features.js';

/**
 * Currency used for the global plan catalogue. `Plan.price` is stored as a bare
 * `Decimal(10,2)` with no currency column (plans are platform-global), so the
 * currency is a fixed configuration constant applied when mapping the column to
 * {@link import('@shared/value-objects/money.js').Money}.
 */
export const DEFAULT_PLAN_CURRENCY = 'USD';

/**
 * Canonical seed definition for a single plan. The `features` come from
 * {@link PLAN_FEATURE_MATRIX} (Requirement 10.3); prices/display names are the
 * platform defaults used by {@link import('../use-cases/seed-plans.use-case.js').SeedPlansUseCase}.
 */
export interface PlanSeedDefinition {
  name: PlanName;
  displayName: string;
  description: string;
  /** Decimal string in {@link DEFAULT_PLAN_CURRENCY}. */
  price: string;
  billingCycle: BillingCycle;
  features: readonly FeatureName[];
}

/**
 * The initial plan catalogue (Requirement 10.1): Starter, Business, Enterprise.
 * Feature sets are sourced from {@link PLAN_FEATURE_MATRIX} so the seed and the
 * documented plan → feature mapping never drift.
 */
export const PLAN_SEED_DEFINITIONS: readonly PlanSeedDefinition[] = [
  {
    name: PLAN_NAMES.STARTER,
    displayName: 'Starter',
    description: 'Ventas y Clientes para empezar.',
    price: '29.00',
    billingCycle: 'monthly',
    features: PLAN_FEATURE_MATRIX[PLAN_NAMES.STARTER],
  },
  {
    name: PLAN_NAMES.BUSINESS,
    displayName: 'Business',
    description: 'Suma Stock, Caja y Reportes para tu operación.',
    price: '79.00',
    billingCycle: 'monthly',
    features: PLAN_FEATURE_MATRIX[PLAN_NAMES.BUSINESS],
  },
  {
    name: PLAN_NAMES.ENTERPRISE,
    displayName: 'Enterprise',
    description: 'Todo incluido: Compras, API, Sucursales, Dashboard e Integraciones.',
    price: '199.00',
    billingCycle: 'monthly',
    features: PLAN_FEATURE_MATRIX[PLAN_NAMES.ENTERPRISE],
  },
];

/** Input for {@link import('../use-cases/create-subscription.use-case.js').CreateSubscriptionUseCase}. */
export interface CreateSubscriptionInputDto {
  tenantId: UUID;
  /** The plan to subscribe to (must exist and be active). */
  planId: UUID;
  /**
   * Explicit term end. When omitted, the use case derives it from the plan's
   * billing cycle (start + 1 month for `monthly`, + 1 year for `yearly`).
   */
  endDate?: Date;
  /** Defaults to `true`. */
  autoRenew?: boolean;
}

/** Input for {@link import('../use-cases/check-feature-access.use-case.js').CheckFeatureAccessUseCase}. */
export interface CheckFeatureAccessInputDto {
  tenantId: UUID;
  /** The feature key to resolve (e.g. `stock`). */
  feature: string;
}

/** Input for {@link import('../use-cases/get-current-subscription.use-case.js').GetCurrentSubscriptionUseCase}. */
export interface GetCurrentSubscriptionInputDto {
  tenantId: UUID;
}

/** Input for {@link import('../use-cases/upgrade-subscription.use-case.js').UpgradeSubscriptionUseCase}. */
export interface UpgradeSubscriptionInputDto {
  tenantId: UUID;
  /** The subscription being upgraded — validated to belong to the caller's tenant. */
  subscriptionId: UUID;
  /** The plan to switch to (must exist and be active). */
  planId: UUID;
  /**
   * Explicit term end for the new subscription. When omitted, it is derived from
   * the target plan's billing cycle, mirroring {@link CreateSubscriptionInputDto}.
   */
  endDate?: Date;
  /** Defaults to `true`. */
  autoRenew?: boolean;
}

/** Public projection of a plan. Price is exposed as a decimal string + currency. */
export interface PlanOutput {
  id: UUID;
  name: string;
  displayName: string;
  description: Nullable<string>;
  price: string;
  currency: string;
  billingCycle: BillingCycle;
  features: string[];
  isActive: boolean;
}

/** Public projection of a subscription. Dates are ISO-8601 strings. */
export interface SubscriptionOutput {
  id: UUID;
  tenantId: UUID;
  planId: UUID;
  status: SubscriptionStatus;
  startDate: string;
  endDate: Nullable<string>;
  autoRenew: boolean;
}

/**
 * Temporal entitlement state of a subscription at the moment it is resolved.
 *
 * Distinct from the persisted {@link SubscriptionStatus}: a subscription whose
 * persisted status is `active` is reported here as `expired` once its `endDate`
 * has passed, mirroring the feature-access read path (Requirement 10.6).
 */
export type CurrentSubscriptionStatus = 'active' | 'expired';

/**
 * Public projection of a tenant's current subscription joined with its plan
 * (the `GET /api/v1/subscriptions/current` view). Bundles the subscription, the
 * resolved plan details, the computed temporal {@link currentStatus} and the
 * term `endDate` for convenience.
 */
export interface CurrentSubscriptionOutput {
  subscription: SubscriptionOutput;
  plan: PlanOutput;
  /** Computed temporal status (`active` while the term is live, else `expired`). */
  currentStatus: CurrentSubscriptionStatus;
  /** The subscription's term end as an ISO-8601 string, or `null` when open-ended. */
  endDate: Nullable<string>;
}

/** Public projection of a feature-access decision (Requirement 10.4). */
export interface FeatureAccessOutput {
  tenantId: UUID;
  feature: string;
  allowed: boolean;
  /** The denial cause when `allowed` is `false`; omitted when access is granted. */
  reason?: FeatureDenialReason;
}

/** Maps a {@link Plan} to its public projection. */
export function toPlanOutput(plan: Plan): PlanOutput {
  return {
    id: plan.id,
    name: plan.name,
    displayName: plan.displayName,
    description: plan.description,
    price: plan.price.toDecimalString(),
    currency: plan.price.currency,
    billingCycle: plan.billingCycle,
    features: plan.features,
    isActive: plan.isActive,
  };
}

/** Maps a {@link Subscription} to its public projection. */
export function toSubscriptionOutput(subscription: Subscription): SubscriptionOutput {
  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    planId: subscription.planId,
    status: subscription.status,
    startDate: subscription.startDate.toISOString(),
    endDate: subscription.endDate === null ? null : subscription.endDate.toISOString(),
    autoRenew: subscription.autoRenew,
  };
}

/**
 * Maps a {@link Subscription} together with its resolved {@link Plan} to the
 * `current subscription` projection, computing the temporal status from `now`.
 */
export function toCurrentSubscriptionOutput(
  subscription: Subscription,
  plan: Plan,
  now: Date | number = Date.now(),
): CurrentSubscriptionOutput {
  const output = toSubscriptionOutput(subscription);
  return {
    subscription: output,
    plan: toPlanOutput(plan),
    currentStatus: subscription.isActive(now) ? 'active' : 'expired',
    endDate: output.endDate,
  };
}
