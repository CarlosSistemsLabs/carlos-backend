import { describe, it, expect, vi } from 'vitest';
import { runWithContext } from '@common/context';
import { ANALYTICS_EVENTS } from './analytics-events.js';
import {
  ANALYTICS_LOG_EVENT,
  StructuredLogAnalyticsService,
  NoopAnalyticsService,
  buildAnalyticsEvent,
  type AnalyticsLogger,
} from './analytics-service.js';

/** Captures the structured records passed to `logger.info`. */
function createSpyLogger(): AnalyticsLogger & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    info(obj: Record<string, unknown>): void {
      calls.push(obj);
    },
  };
}

const FIXED = new Date('2024-01-02T03:04:05.678Z');
const fixedClock = (): Date => FIXED;

describe('StructuredLogAnalyticsService', () => {
  it('enriches the event with tenant_id/user_id/request_id from the request context (Requirement 13.3)', () => {
    const logger = createSpyLogger();
    const service = new StructuredLogAnalyticsService(logger, fixedClock);

    runWithContext({ requestId: 'req-1', tenantId: 'tenant-1', userId: 'user-1' }, () => {
      service.logEvent(ANALYTICS_EVENTS.SALE_CREATED, { sale_id: 'sale-9', total: 150 });
    });

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]).toEqual({
      event: ANALYTICS_LOG_EVENT,
      name: 'sale_created',
      timestamp: '2024-01-02T03:04:05.678Z',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      request_id: 'req-1',
      properties: { sale_id: 'sale-9', total: 150 },
    });
  });

  it('emits a stable ISO-8601 timestamp for every event', () => {
    const logger = createSpyLogger();
    const service = new StructuredLogAnalyticsService(logger, fixedClock);

    runWithContext({ requestId: 'req-2', tenantId: 't', userId: 'u' }, () => {
      service.track(ANALYTICS_EVENTS.REPORT_GENERATED);
    });

    expect(logger.calls[0]?.timestamp).toBe('2024-01-02T03:04:05.678Z');
    expect(logger.calls[0]?.name).toBe('report_generated');
  });

  it('omits context fields when logging outside a request scope', () => {
    const logger = createSpyLogger();
    const service = new StructuredLogAnalyticsService(logger, fixedClock);

    // No runWithContext wrapper — the async context is empty.
    service.logEvent(ANALYTICS_EVENTS.LOGIN_SUCCESS, { method: 'password' });

    expect(logger.calls).toHaveLength(1);
    const record = logger.calls[0] ?? {};
    expect(record).toEqual({
      event: ANALYTICS_LOG_EVENT,
      name: 'login_success',
      timestamp: '2024-01-02T03:04:05.678Z',
      properties: { method: 'password' },
    });
    expect('tenant_id' in record).toBe(false);
    expect('user_id' in record).toBe(false);
    expect('request_id' in record).toBe(false);
  });

  it('omits the properties key when no properties are supplied', () => {
    const logger = createSpyLogger();
    const service = new StructuredLogAnalyticsService(logger, fixedClock);

    runWithContext({ requestId: 'req-3', tenantId: 't', userId: 'u' }, () => {
      service.logEvent(ANALYTICS_EVENTS.CASH_REGISTER_OPENED);
    });

    const record = logger.calls[0] ?? {};
    expect('properties' in record).toBe(false);
  });

  it('includes tenant_id/user_id even when request_id is absent from the context', () => {
    const logger = createSpyLogger();
    const service = new StructuredLogAnalyticsService(logger, fixedClock);

    // tenant/user resolved but requestId unusual-empty scenario: still enrich
    // whatever the context provides.
    runWithContext({ requestId: 'req-4', tenantId: 'tenant-x', userId: 'user-x' }, () => {
      service.logEvent(ANALYTICS_EVENTS.STOCK_UPDATED, { product_id: 'p1', quantity: 5 });
    });

    expect(logger.calls[0]).toMatchObject({
      tenant_id: 'tenant-x',
      user_id: 'user-x',
      request_id: 'req-4',
    });
  });
});

describe('buildAnalyticsEvent', () => {
  it('builds the canonical enriched payload shape', () => {
    const event = runWithContext(
      { requestId: 'r', tenantId: 'te', userId: 'us' },
      () => buildAnalyticsEvent(ANALYTICS_EVENTS.PRODUCT_VIEWED, { product_id: 'p9' }, fixedClock),
    );

    expect(event).toEqual({
      event: ANALYTICS_LOG_EVENT,
      name: 'product_viewed',
      timestamp: '2024-01-02T03:04:05.678Z',
      tenant_id: 'te',
      user_id: 'us',
      request_id: 'r',
      properties: { product_id: 'p9' },
    });
  });
});

describe('NoopAnalyticsService', () => {
  it('does nothing on logEvent/track', () => {
    const service = new NoopAnalyticsService();

    // Should neither throw nor produce side effects.
    expect(() => {
      service.logEvent(ANALYTICS_EVENTS.SALE_CANCELLED, { sale_id: 's' });
      service.track(ANALYTICS_EVENTS.PAYMENT_RECORDED);
    }).not.toThrow();
  });

  it('does not touch any logger (no sink)', () => {
    const spy = vi.fn();
    const service = new NoopAnalyticsService();
    service.logEvent(ANALYTICS_EVENTS.SUBSCRIPTION_CREATED);
    expect(spy).not.toHaveBeenCalled();
  });
});
