import { describe, it, expect, vi } from 'vitest';
import { runWithContext } from '@common/context';
import {
  StructuredLogCrashReporter,
  NoopCrashReporter,
  buildCrashReport,
  CRASH_REPORT_EVENT,
  type CrashReporterLogger,
} from './crash-reporter.js';

/** A crash logger spy capturing the structured object + message. */
function makeLogger(): {
  logger: CrashReporterLogger;
  error: ReturnType<typeof vi.fn>;
} {
  const error = vi.fn();
  return { logger: { error }, error };
}

const fixedClock = (): Date => new Date('2024-01-02T03:04:05.000Z');

describe('StructuredLogCrashReporter.reportError', () => {
  it('enriches the report with tenant/user/request from context + feature/module/role + stack', () => {
    const { logger, error } = makeLogger();
    const reporter = new StructuredLogCrashReporter(logger, fixedClock);
    const boom = new TypeError('kaboom');

    runWithContext({ requestId: 'req-1', tenantId: 'tenant-9', userId: 'user-7' }, () => {
      reporter.reportError(boom, {
        feature: 'POST /api/v1/sales',
        module: 'sales',
        role: 'Admin',
        extra: { attempt: 2 },
      });
    });

    expect(error).toHaveBeenCalledTimes(1);
    const [payload, msg] = error.mock.calls[0] as [Record<string, unknown>, string];

    expect(payload.event).toBe(CRASH_REPORT_EVENT);
    expect(payload.report).toBe(true);
    expect(payload.error_name).toBe('TypeError');
    expect(payload.error_message).toBe('kaboom');
    expect(payload.tenant_id).toBe('tenant-9');
    expect(payload.user_id).toBe('user-7');
    expect(payload.request_id).toBe('req-1');
    expect(payload.feature).toBe('POST /api/v1/sales');
    expect(payload.module).toBe('sales');
    expect(payload.role).toBe('Admin');
    expect(payload.extra).toEqual({ attempt: 2 });
    expect(payload.timestamp).toBe('2024-01-02T03:04:05.000Z');
    expect(typeof payload.stack).toBe('string');
    expect(payload.stack as string).toContain('kaboom');
    expect(msg).toContain('TypeError');
  });

  it('omits tenant/user/request when outside a request context, and optional context fields when absent', () => {
    const { logger, error } = makeLogger();
    const reporter = new StructuredLogCrashReporter(logger, fixedClock);

    reporter.reportError(new Error('lonely'));

    const [payload] = error.mock.calls[0] as [Record<string, unknown>];
    expect(payload.tenant_id).toBeUndefined();
    expect(payload.user_id).toBeUndefined();
    expect(payload.request_id).toBeUndefined();
    expect(payload.feature).toBeUndefined();
    expect(payload.module).toBeUndefined();
    expect(payload.role).toBeUndefined();
    expect(payload.extra).toBeUndefined();
    expect(payload.error_message).toBe('lonely');
  });

  it('never throws even when the underlying logger throws', () => {
    const throwingLogger: CrashReporterLogger = {
      error: () => {
        throw new Error('logger exploded');
      },
    };
    const reporter = new StructuredLogCrashReporter(throwingLogger, fixedClock);

    expect(() => reporter.reportError(new Error('boom'))).not.toThrow();
  });
});

describe('NoopCrashReporter', () => {
  it('does nothing and never throws', () => {
    const reporter = new NoopCrashReporter();
    expect(() => reporter.reportError(new Error('ignored'), { feature: 'x' })).not.toThrow();
  });
});

describe('buildCrashReport', () => {
  it('builds the canonical enriched payload shape', () => {
    const report = runWithContext({ requestId: 'req-42' }, () =>
      buildCrashReport(new Error('oops'), { feature: 'GET /x' }, fixedClock),
    );

    expect(report.event).toBe(CRASH_REPORT_EVENT);
    expect(report.report).toBe(true);
    expect(report.error_name).toBe('Error');
    expect(report.error_message).toBe('oops');
    expect(report.request_id).toBe('req-42');
    expect(report.feature).toBe('GET /x');
    expect(report.timestamp).toBe('2024-01-02T03:04:05.000Z');
  });
});
