import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import { Subscription } from './subscription.js';
import { InvalidSubscriptionStatusTransitionError } from '../errors/subscription-errors.js';

const TENANT = 'tenant-1';
const PLAN = 'plan-1';
const START = new Date('2025-01-01T00:00:00.000Z');
const END = new Date('2025-02-01T00:00:00.000Z');

function makeSubscription(
  overrides: Partial<Parameters<typeof Subscription.create>[0]> = {},
): Subscription {
  return Subscription.create({
    tenantId: TENANT,
    planId: PLAN,
    startDate: START,
    endDate: END,
    ...overrides,
  });
}

describe('Subscription', () => {
  describe('create', () => {
    it('creates an active subscription with defaults', () => {
      const sub = Subscription.create({ tenantId: TENANT, planId: PLAN, startDate: START });
      expect(sub.tenantId).toBe(TENANT);
      expect(sub.planId).toBe(PLAN);
      expect(sub.status).toBe('active');
      expect(sub.endDate).toBeNull();
      expect(sub.autoRenew).toBe(true);
    });

    it('rejects a blank tenantId', () => {
      expect(() => makeSubscription({ tenantId: '  ' })).toThrow(ValidationError);
    });

    it('rejects a blank planId', () => {
      expect(() => makeSubscription({ planId: '' })).toThrow(ValidationError);
    });

    it('rejects an endDate at or before startDate', () => {
      expect(() => makeSubscription({ endDate: START })).toThrow(ValidationError);
      expect(() =>
        makeSubscription({ endDate: new Date('2024-12-31T00:00:00.000Z') }),
      ).toThrow(ValidationError);
    });
  });

  describe('isActive', () => {
    it('is active when status is active and endDate is in the future', () => {
      const sub = makeSubscription();
      expect(sub.isActive(new Date('2025-01-15T00:00:00.000Z'))).toBe(true);
    });

    it('is active for an open-ended (null endDate) subscription', () => {
      const sub = makeSubscription({ endDate: null });
      expect(sub.isActive(new Date('2030-01-01T00:00:00.000Z'))).toBe(true);
    });

    it('is not active once the endDate has passed', () => {
      const sub = makeSubscription();
      expect(sub.isActive(new Date('2025-03-01T00:00:00.000Z'))).toBe(false);
    });

    it('treats the exact endDate boundary as lapsed (endDate is exclusive)', () => {
      const sub = makeSubscription();
      expect(sub.isActive(END)).toBe(false);
    });

    it('is not active when cancelled even before the endDate', () => {
      const sub = makeSubscription();
      sub.cancel();
      expect(sub.isActive(new Date('2025-01-15T00:00:00.000Z'))).toBe(false);
    });

    it('accepts an epoch-millis reference instant', () => {
      const sub = makeSubscription();
      expect(sub.isActive(new Date('2025-01-15T00:00:00.000Z').getTime())).toBe(true);
    });
  });

  describe('isExpired', () => {
    it('is expired at or after the endDate regardless of status', () => {
      const sub = makeSubscription();
      expect(sub.isExpired(END)).toBe(true);
      expect(sub.isExpired(new Date('2025-03-01T00:00:00.000Z'))).toBe(true);
    });

    it('is not expired before the endDate', () => {
      const sub = makeSubscription();
      expect(sub.isExpired(new Date('2025-01-15T00:00:00.000Z'))).toBe(false);
    });

    it('an open-ended subscription never expires', () => {
      const sub = makeSubscription({ endDate: null });
      expect(sub.isExpired(new Date('2999-01-01T00:00:00.000Z'))).toBe(false);
    });
  });

  describe('cancel', () => {
    it('sets status to cancelled and disables autoRenew', () => {
      const sub = makeSubscription();
      sub.cancel();
      expect(sub.status).toBe('cancelled');
      expect(sub.autoRenew).toBe(false);
    });

    it('rejects cancelling an already-cancelled subscription', () => {
      const sub = makeSubscription();
      sub.cancel();
      expect(() => sub.cancel()).toThrow(InvalidSubscriptionStatusTransitionError);
    });

    it('can cancel an expired subscription', () => {
      const sub = makeSubscription();
      sub.expire();
      sub.cancel();
      expect(sub.status).toBe('cancelled');
    });
  });

  describe('expire', () => {
    it('sets status to expired', () => {
      const sub = makeSubscription();
      sub.expire();
      expect(sub.status).toBe('expired');
    });

    it('rejects expiring a cancelled subscription', () => {
      const sub = makeSubscription();
      sub.cancel();
      expect(() => sub.expire()).toThrow(InvalidSubscriptionStatusTransitionError);
    });

    it('rejects expiring an already-expired subscription', () => {
      const sub = makeSubscription();
      sub.expire();
      expect(() => sub.expire()).toThrow(InvalidSubscriptionStatusTransitionError);
    });
  });

  describe('renew', () => {
    it('extends the term and keeps an active subscription active', () => {
      const sub = makeSubscription();
      const newEnd = new Date('2025-03-01T00:00:00.000Z');
      sub.renew(newEnd);
      expect(sub.status).toBe('active');
      expect(sub.endDate).toEqual(newEnd);
    });

    it('revives an expired subscription', () => {
      const sub = makeSubscription();
      sub.expire();
      const newEnd = new Date('2025-04-01T00:00:00.000Z');
      sub.renew(newEnd);
      expect(sub.status).toBe('active');
      expect(sub.endDate).toEqual(newEnd);
    });

    it('rejects renewing a cancelled (terminal) subscription', () => {
      const sub = makeSubscription();
      sub.cancel();
      expect(() => sub.renew(new Date('2025-04-01T00:00:00.000Z'))).toThrow(
        InvalidSubscriptionStatusTransitionError,
      );
    });

    it('rejects a newEndDate at or before startDate', () => {
      const sub = makeSubscription();
      expect(() => sub.renew(START)).toThrow(ValidationError);
    });
  });

  describe('reconstitute', () => {
    it('rehydrates persisted state without re-validation', () => {
      const sub = Subscription.reconstitute('sub-1', {
        tenantId: TENANT,
        planId: PLAN,
        status: 'expired',
        startDate: START,
        endDate: END,
        autoRenew: false,
      });
      expect(sub.id).toBe('sub-1');
      expect(sub.status).toBe('expired');
      expect(sub.autoRenew).toBe(false);
    });
  });
});
