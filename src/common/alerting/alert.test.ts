import { describe, it, expect, vi } from 'vitest';
import { LogAlertNotifier, ALERT_EVENT, type AlertLogger } from './alert.js';

const FIXED = new Date('2024-05-06T07:08:09.000Z');

function makeLogger(): AlertLogger & { error: ReturnType<typeof vi.fn>; fatal: ReturnType<typeof vi.fn> } {
  return { error: vi.fn(), fatal: vi.fn() };
}

describe('LogAlertNotifier', () => {
  it('emits a structured alert line at error level for a warning alert', () => {
    const logger = makeLogger();
    const notifier = new LogAlertNotifier(logger, () => FIXED);

    notifier.sendAlert({
      severity: 'warning',
      title: 'Elevated latency',
      description: 'p99 is high',
      context: { p99: 1200 },
    });

    expect(logger.fatal).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      {
        alert: true,
        event: ALERT_EVENT,
        severity: 'warning',
        title: 'Elevated latency',
        description: 'p99 is high',
        context: { p99: 1200 },
        timestamp: FIXED.toISOString(),
      },
      'Elevated latency',
    );
  });

  it('emits critical alerts at fatal level so log-based rules can page', () => {
    const logger = makeLogger();
    const notifier = new LogAlertNotifier(logger, () => FIXED);

    notifier.sendAlert({
      severity: 'critical',
      title: 'Server error rate threshold exceeded',
      description: 'too many 5xx',
    });

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: true,
        event: ALERT_EVENT,
        severity: 'critical',
        context: {},
      }),
      'Server error rate threshold exceeded',
    );
  });
});
