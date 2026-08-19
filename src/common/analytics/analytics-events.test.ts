import { describe, it, expect } from 'vitest';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  isAnalyticsEventName,
} from './analytics-events.js';

describe('ANALYTICS_EVENTS catalog', () => {
  it('exposes every required canonical event name (Requirement 13.2)', () => {
    // The names below are the cross-platform contract; asserting their exact
    // values guards against accidental renames that would silently split
    // analytics between platforms.
    expect(ANALYTICS_EVENTS).toMatchObject({
      LOGIN_SUCCESS: 'login_success',
      LOGIN_FAILED: 'login_failed',
      USER_REGISTERED: 'user_registered',
      SALE_CREATED: 'sale_created',
      SALE_CANCELLED: 'sale_cancelled',
      PURCHASE_CREATED: 'purchase_created',
      PRODUCT_VIEWED: 'product_viewed',
      PRODUCT_CREATED: 'product_created',
      STOCK_UPDATED: 'stock_updated',
      STOCK_LOW_ALERT: 'stock_low_alert',
      PAYMENT_RECORDED: 'payment_recorded',
      REPORT_GENERATED: 'report_generated',
      CASH_REGISTER_OPENED: 'cash_register_opened',
      CASH_REGISTER_CLOSED: 'cash_register_closed',
      SUBSCRIPTION_CREATED: 'subscription_created',
    });
  });

  it('uses Firebase-compatible snake_case names (<= 40 chars, no spaces)', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name.length).toBeLessThanOrEqual(40);
    }
  });

  it('has no duplicate event names', () => {
    const unique = new Set(ANALYTICS_EVENT_NAMES);
    expect(unique.size).toBe(ANALYTICS_EVENT_NAMES.length);
  });

  it('is immutable at runtime (frozen catalog)', () => {
    expect(Object.isFrozen(ANALYTICS_EVENT_NAMES)).toBe(true);
    expect(() => {
      // @ts-expect-error — verifying runtime immutability of the frozen names array
      ANALYTICS_EVENT_NAMES.push('tampered');
    }).toThrow();
  });

  it('recognizes canonical names and rejects off-catalog names', () => {
    expect(isAnalyticsEventName('sale_created')).toBe(true);
    expect(isAnalyticsEventName('login_success')).toBe(true);
    expect(isAnalyticsEventName('not_a_real_event')).toBe(false);
    expect(isAnalyticsEventName('')).toBe(false);
  });
});
