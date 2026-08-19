import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import { InvalidSubscriptionStatusTransitionError } from '../errors/subscription-errors.js';
import {
  assertSubscriptionStatus,
  assertTransition,
  canTransition,
  isSubscriptionStatus,
  SUBSCRIPTION_STATUSES,
} from './subscription-status.js';

describe('subscription-status', () => {
  it('lists the three valid statuses', () => {
    expect(SUBSCRIPTION_STATUSES).toEqual(['active', 'cancelled', 'expired']);
  });

  it('guards recognised statuses', () => {
    expect(isSubscriptionStatus('active')).toBe(true);
    expect(isSubscriptionStatus('paused')).toBe(false);
  });

  it('assertSubscriptionStatus returns the value or throws', () => {
    expect(assertSubscriptionStatus('expired')).toBe('expired');
    expect(() => assertSubscriptionStatus('paused')).toThrow(ValidationError);
  });

  describe('transitions', () => {
    it('permits active → cancelled/expired', () => {
      expect(canTransition('active', 'cancelled')).toBe(true);
      expect(canTransition('active', 'expired')).toBe(true);
    });

    it('permits expired → active/cancelled', () => {
      expect(canTransition('expired', 'active')).toBe(true);
      expect(canTransition('expired', 'cancelled')).toBe(true);
    });

    it('treats cancelled as terminal', () => {
      expect(canTransition('cancelled', 'active')).toBe(false);
      expect(canTransition('cancelled', 'expired')).toBe(false);
    });

    it('assertTransition throws on an illegal transition', () => {
      expect(() => assertTransition('cancelled', 'active')).toThrow(
        InvalidSubscriptionStatusTransitionError,
      );
      expect(() => assertTransition('active', 'cancelled')).not.toThrow();
    });
  });
});
