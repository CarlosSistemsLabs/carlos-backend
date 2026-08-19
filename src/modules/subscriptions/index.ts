/**
 * Public façade for the Subscriptions module.
 *
 * Owns plan/subscription entitlement and per-tenant feature toggling: it
 * answers "is this feature available to this tenant right now?" by combining
 * the tenant's active subscription plan (Requirement 10) with tenant-specific
 * feature flags (Requirement 12). Other modules, the presentation layer, and
 * the composition root MUST consume these capabilities through this barrel
 * rather than reaching into internals.
 */

// Domain service port + result type
export type {
  IFeatureAccessService,
  FeatureAccessDecision,
} from './domain/services/feature-access-service.js';

// Plan → feature mapping + feature catalogue (Requirement 10.3)
export {
  FEATURES,
  PLAN_NAMES,
  PLAN_FEATURE_MATRIX,
  type FeatureName,
  type PlanName,
} from './domain/constants/plan-features.js';

// Errors
export {
  SubscriptionRequiredError,
  FeatureDisabledError,
  InvalidSubscriptionStatusTransitionError,
  InactivePlanError,
  type FeatureDenialReason,
} from './domain/errors/subscription-errors.js';

// Domain entities (Plan/Subscription aggregates — task 29.1)
export {
  Plan,
  type PlanProps,
  type CreatePlanInput,
} from './domain/entities/plan.js';
export {
  Subscription,
  type SubscriptionProps,
  type CreateSubscriptionInput,
} from './domain/entities/subscription.js';

// Value objects
export {
  BILLING_CYCLES,
  isBillingCycle,
  assertBillingCycle,
  type BillingCycle,
} from './domain/value-objects/billing-cycle.js';
export {
  SUBSCRIPTION_STATUSES,
  DEFAULT_SUBSCRIPTION_STATUS,
  isSubscriptionStatus,
  assertSubscriptionStatus,
  canTransition,
  type SubscriptionStatus,
} from './domain/value-objects/subscription-status.js';

// Repository ports (implemented by infrastructure)
export type { IPlanRepository } from './domain/repositories/plan-repository.js';
export type { ISubscriptionRepository } from './domain/repositories/subscription-repository.js';

// Use cases (application entry points — task 29.1, 29.3)
export { CreateSubscriptionUseCase } from './application/use-cases/create-subscription.use-case.js';
export { CheckFeatureAccessUseCase } from './application/use-cases/check-feature-access.use-case.js';
export { SeedPlansUseCase } from './application/use-cases/seed-plans.use-case.js';
export { GetCurrentSubscriptionUseCase } from './application/use-cases/get-current-subscription.use-case.js';
export { ListPlansUseCase } from './application/use-cases/list-plans.use-case.js';
export { UpgradeSubscriptionUseCase } from './application/use-cases/upgrade-subscription.use-case.js';
export { addMonths, computeTermEnd } from './application/use-cases/billing-term.js';

// DTOs + mappers + seed catalogue
export {
  DEFAULT_PLAN_CURRENCY,
  PLAN_SEED_DEFINITIONS,
  toPlanOutput,
  toSubscriptionOutput,
  toCurrentSubscriptionOutput,
  type PlanSeedDefinition,
  type CreateSubscriptionInputDto,
  type CheckFeatureAccessInputDto,
  type GetCurrentSubscriptionInputDto,
  type UpgradeSubscriptionInputDto,
  type PlanOutput,
  type SubscriptionOutput,
  type CurrentSubscriptionOutput,
  type CurrentSubscriptionStatus,
  type FeatureAccessOutput,
} from './application/dto/subscription-dtos.js';

// Infrastructure implementation
export {
  PrismaFeatureAccessService,
  type FeatureAccessPrismaClient,
  type SubscriptionModelDelegate,
  type FeatureFlagModelDelegate,
  type SubscriptionWithPlanRow,
  type FeatureFlagRow,
  type PlanRow,
} from './infrastructure/prisma-feature-access-service.js';
export {
  PrismaPlanRepository,
  type PlanPrismaClient,
  type PlanModelDelegate,
  type PlanRow as PlanCatalogueRow,
  type DecimalLike,
} from './infrastructure/prisma-plan-repository.js';
export {
  PrismaSubscriptionRepository,
  type SubscriptionPrismaClient,
  type SubscriptionModelDelegate as SubscriptionCatalogueDelegate,
  type SubscriptionRow,
} from './infrastructure/prisma-subscription-repository.js';

// Presentation (HTTP routes — task 29.3)
export {
  registerSubscriptionRoutes,
  buildSubscriptionUseCases,
  subscriptionRoutesPlugin,
  planRoutesPlugin,
  type SubscriptionRoutesOptions,
} from './presentation/subscription.routes.js';
