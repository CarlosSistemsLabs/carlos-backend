import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import { FEATURES } from '../constants/plan-features.js';
import { assertBillingCycle, type BillingCycle } from '../value-objects/billing-cycle.js';

/** The set of feature keys the platform recognises (values of {@link FEATURES}). */
const KNOWN_FEATURES: ReadonlySet<string> = new Set<string>(Object.values(FEATURES));

/** Attributes describing a subscription plan. */
export interface PlanProps {
  /** Canonical, unique plan key (e.g. `starter`). Immutable, global (no tenant). */
  name: string;
  /** Human-facing plan name (e.g. `Starter`). */
  displayName: string;
  description: Nullable<string>;
  /** Recurring price. Never negative. */
  price: Money;
  billingCycle: BillingCycle;
  /**
   * The feature keys this plan grants (Requirement 10.3). Every entry must be a
   * known {@link FEATURES} key; duplicates are collapsed on creation.
   */
  features: readonly string[];
  isActive: boolean;
}

/** Input accepted by {@link Plan.create}. */
export interface CreatePlanInput {
  name: string;
  displayName: string;
  description?: Nullable<string>;
  price: Money;
  billingCycle: BillingCycle | string;
  features: readonly string[];
  /** Defaults to `true` (a new plan is available for subscription). */
  isActive?: boolean;
}

/**
 * Subscription plan aggregate (Requirement 10.1).
 *
 * A plan is a **platform-global catalogue entry** — it is NOT tenant-scoped, so
 * it carries no `tenantId`. It bundles a set of feature keys (Requirement 10.3)
 * that a subscribed tenant is entitled to, priced per {@link BillingCycle}.
 *
 * **Configuration-driven features (Requirement 10.5):** the authoritative list
 * of a plan's features is the `features` JSON array persisted on the row, so new
 * or edited plans are honoured without code changes. The entity guards that
 * every feature key is one the platform actually recognises ({@link FEATURES}),
 * so a typo cannot silently grant a non-existent feature.
 *
 * **Retirement:** {@link deactivate} takes a plan out of the catalogue (no new
 * subscriptions) without deleting it; {@link activate} restores it. Existing
 * subscriptions are unaffected by a plan's active flag on their own — the
 * feature-access path additionally checks `isActive` when resolving entitlement.
 */
export class Plan extends AggregateRoot<PlanProps> {
  private constructor(props: PlanProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Creates a validated plan.
   *
   * @throws {ValidationError} when the name/displayName is blank, the price is
   *   negative, the billing cycle is unrecognised, or any feature key is not a
   *   known {@link FEATURES} key.
   */
  static create(input: CreatePlanInput, id?: UUID): Plan {
    const name = Plan.assertName(input.name, 'Plan name');
    const displayName = Plan.assertName(input.displayName, 'Plan display name');
    const billingCycle = assertBillingCycle(input.billingCycle);
    if (input.price.isNegative()) {
      throw new ValidationError('Plan price cannot be negative', {
        price: input.price.toString(),
      });
    }
    const features = Plan.assertFeatures(input.features);
    return new Plan(
      {
        name,
        displayName,
        description: input.description ?? null,
        price: input.price,
        billingCycle,
        features,
        isActive: input.isActive ?? true,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Plan} from already-validated persisted state. Trusts the
   * data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: PlanProps): Plan {
    return new Plan({ ...props, features: [...props.features] }, id);
  }

  get name(): string {
    return this.props.name;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get description(): Nullable<string> {
    return this.props.description;
  }

  get price(): Money {
    return this.props.price;
  }

  get billingCycle(): BillingCycle {
    return this.props.billingCycle;
  }

  /** The feature keys granted by this plan (a defensive copy). */
  get features(): string[] {
    return [...this.props.features];
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  /** Returns `true` when this plan grants the given feature key. */
  hasFeature(featureKey: string): boolean {
    return this.props.features.includes(featureKey);
  }

  /** Restores the plan to the catalogue (available for new subscriptions). */
  activate(): void {
    this.props.isActive = true;
  }

  /** Retires the plan from the catalogue (no new subscriptions). */
  deactivate(): void {
    this.props.isActive = false;
  }

  private static assertName(value: string, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError(`${label} is required`, { value });
    }
    return value.trim();
  }

  private static assertFeatures(features: readonly string[]): readonly string[] {
    if (!Array.isArray(features)) {
      throw new ValidationError('Plan features must be an array', { features });
    }
    const unknown = features.filter((feature) => !KNOWN_FEATURES.has(feature));
    if (unknown.length > 0) {
      throw new ValidationError('Plan references unknown feature keys', {
        unknown,
        known: [...KNOWN_FEATURES],
      });
    }
    // Collapse duplicates while preserving first-seen order.
    return [...new Set(features)];
  }
}
