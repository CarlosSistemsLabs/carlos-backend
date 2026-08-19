import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import {
  assertTransition,
  DEFAULT_SUBSCRIPTION_STATUS,
  type SubscriptionStatus,
} from '../value-objects/subscription-status.js';

/** Attributes describing a tenant's subscription to a plan. */
export interface SubscriptionProps {
  tenantId: UUID;
  planId: UUID;
  status: SubscriptionStatus;
  startDate: Date;
  /** The term end. `null` means an open-ended subscription that never lapses. */
  endDate: Nullable<Date>;
  /** Whether the subscription renews automatically at the end of its term. */
  autoRenew: boolean;
}

/** Input accepted by {@link Subscription.create}. */
export interface CreateSubscriptionInput {
  tenantId: UUID;
  planId: UUID;
  /** Defaults to `active`. */
  status?: SubscriptionStatus;
  /** Defaults to now. */
  startDate?: Date;
  /** Defaults to `null` (open-ended). Must be strictly after `startDate`. */
  endDate?: Nullable<Date>;
  /** Defaults to `true`. */
  autoRenew?: boolean;
}

/**
 * Subscription aggregate (Requirement 10.2): the link between a tenant and the
 * {@link import('./plan.js').Plan} whose features it is entitled to.
 *
 * **Tenant-scoped:** unlike {@link import('./plan.js').Plan} (a global
 * catalogue), a subscription belongs to a single tenant and is persisted through
 * the tenant-aware client.
 *
 * **Active vs. status:** the persisted `status` records the lifecycle decision
 * (`active` / `cancelled` / `expired`), while {@link isActive} answers the
 * temporal question — a subscription grants access only when it is `active` AND
 * its `endDate` (if any) is still in the future. This mirrors the feature-access
 * path, which treats a passed `endDate` as expired even before a background job
 * flips the status (Requirement 10.6).
 *
 * Lifecycle transitions ({@link cancel}, {@link expire}, {@link renew}) are
 * validated by the status state machine so a cancelled subscription is terminal
 * and an expired one can only come back through a renewal.
 */
export class Subscription extends AggregateRoot<SubscriptionProps> {
  private constructor(props: SubscriptionProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Creates a validated subscription.
   *
   * @throws {ValidationError} when `tenantId` / `planId` is missing or `endDate`
   *   is not strictly after `startDate`.
   */
  static create(input: CreateSubscriptionInput, id?: UUID): Subscription {
    const tenantId = Subscription.assertId(input.tenantId, 'tenantId');
    const planId = Subscription.assertId(input.planId, 'planId');
    const startDate = input.startDate ?? new Date();
    const endDate = input.endDate ?? null;
    Subscription.assertTerm(startDate, endDate);
    return new Subscription(
      {
        tenantId,
        planId,
        status: input.status ?? DEFAULT_SUBSCRIPTION_STATUS,
        startDate,
        endDate,
        autoRenew: input.autoRenew ?? true,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Subscription} from already-validated persisted state.
   * Trusts the data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: SubscriptionProps): Subscription {
    return new Subscription({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get planId(): UUID {
    return this.props.planId;
  }

  get status(): SubscriptionStatus {
    return this.props.status;
  }

  get startDate(): Date {
    return this.props.startDate;
  }

  get endDate(): Nullable<Date> {
    return this.props.endDate;
  }

  get autoRenew(): boolean {
    return this.props.autoRenew;
  }

  /**
   * Whether the subscription currently grants access: its status is `active`
   * AND its term has not lapsed (`endDate` is `null` or strictly after `now`).
   *
   * @param now - The reference instant (epoch ms or a {@link Date}). Defaults to
   *   the current time. Injectable for deterministic tests.
   */
  isActive(now: Date | number = Date.now()): boolean {
    if (this.props.status !== 'active') {
      return false;
    }
    return !this.hasLapsed(now);
  }

  /**
   * Whether the subscription's term has lapsed at `now` — i.e. it has an
   * `endDate` that is at or before `now`. Open-ended subscriptions (no
   * `endDate`) never expire. This is a purely temporal check independent of the
   * persisted `status`.
   */
  isExpired(now: Date | number = Date.now()): boolean {
    return this.hasLapsed(now);
  }

  /**
   * Cancels the subscription (terminal).
   *
   * @throws {InvalidSubscriptionStatusTransitionError} when the subscription is
   *   already cancelled.
   */
  cancel(): void {
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled';
    this.props.autoRenew = false;
  }

  /**
   * Marks the subscription expired (its term lapsed and it was not renewed).
   *
   * @throws {InvalidSubscriptionStatusTransitionError} when the subscription is
   *   cancelled or already expired.
   */
  expire(): void {
    assertTransition(this.props.status, 'expired');
    this.props.status = 'expired';
  }

  /**
   * Renews the subscription, extending its term to `newEndDate` and (re)setting
   * the status to `active` — reviving an expired subscription. `newEndDate` must
   * be strictly after the current `startDate`.
   *
   * @throws {ValidationError} when `newEndDate` is not strictly after `startDate`.
   * @throws {InvalidSubscriptionStatusTransitionError} when the subscription is
   *   cancelled (terminal).
   */
  renew(newEndDate: Date): void {
    Subscription.assertTerm(this.props.startDate, newEndDate);
    if (this.props.status !== 'active') {
      assertTransition(this.props.status, 'active');
    }
    this.props.status = 'active';
    this.props.endDate = newEndDate;
  }

  /** `true` when a finite `endDate` is at or before `now`. */
  private hasLapsed(now: Date | number): boolean {
    if (this.props.endDate === null) {
      return false;
    }
    const nowMs = typeof now === 'number' ? now : now.getTime();
    return this.props.endDate.getTime() <= nowMs;
  }

  private static assertId(value: UUID, label: string): UUID {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError(`Subscription ${label} is required`, { value });
    }
    return value;
  }

  private static assertTerm(startDate: Date, endDate: Nullable<Date>): void {
    if (endDate !== null && endDate.getTime() <= startDate.getTime()) {
      throw new ValidationError('Subscription endDate must be after startDate', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }
  }
}
