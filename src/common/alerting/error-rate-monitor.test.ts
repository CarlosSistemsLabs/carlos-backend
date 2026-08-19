import { describe, it, expect, vi } from 'vitest';
import { ErrorRateMonitor } from './error-rate-monitor.js';
import type { IAlertNotifier } from './alert.js';

function makeNotifier(): IAlertNotifier & { sendAlert: ReturnType<typeof vi.fn> } {
  return { sendAlert: vi.fn() };
}

/** A controllable millisecond clock. */
function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('ErrorRateMonitor', () => {
  it('does not alert below the threshold', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    const monitor = new ErrorRateMonitor(notifier, {
      threshold: 3,
      windowMs: 1000,
      cooldownMs: 5000,
      now: clock.now,
    });

    monitor.recordServerError();
    monitor.recordServerError();

    expect(notifier.sendAlert).not.toHaveBeenCalled();
    expect(monitor.currentCount).toBe(2);
  });

  it('fires a critical alert when the threshold is reached within the window', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    const monitor = new ErrorRateMonitor(notifier, {
      threshold: 3,
      windowMs: 1000,
      cooldownMs: 5000,
      now: clock.now,
    });

    monitor.recordServerError({ statusCode: 500, path: '/api/v1/sales', requestId: 'req-1' });
    clock.advance(100);
    monitor.recordServerError({ statusCode: 502 });
    clock.advance(100);
    monitor.recordServerError({ statusCode: 500 });

    expect(notifier.sendAlert).toHaveBeenCalledTimes(1);
    const alert = notifier.sendAlert.mock.calls[0]?.[0];
    expect(alert.severity).toBe('critical');
    expect(alert.context).toMatchObject({ count: 3, threshold: 3, window_ms: 1000 });
  });

  it('does not fire when errors fall outside the rolling window', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    const monitor = new ErrorRateMonitor(notifier, {
      threshold: 3,
      windowMs: 1000,
      cooldownMs: 5000,
      now: clock.now,
    });

    monitor.recordServerError();
    clock.advance(600);
    monitor.recordServerError();
    clock.advance(600); // first error (t=0) is now older than the 1000ms window
    monitor.recordServerError();

    expect(notifier.sendAlert).not.toHaveBeenCalled();
    expect(monitor.currentCount).toBe(2);
  });

  it('respects the cooldown, suppressing repeat alerts during a sustained incident', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    const monitor = new ErrorRateMonitor(notifier, {
      threshold: 2,
      windowMs: 10_000,
      cooldownMs: 5000,
      now: clock.now,
    });

    monitor.recordServerError();
    monitor.recordServerError(); // trips → alert #1
    expect(notifier.sendAlert).toHaveBeenCalledTimes(1);

    clock.advance(1000); // still within cooldown
    monitor.recordServerError();
    monitor.recordServerError();
    expect(notifier.sendAlert).toHaveBeenCalledTimes(1);

    clock.advance(5000); // cooldown elapsed
    monitor.recordServerError();
    expect(notifier.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid configuration', () => {
    const notifier = makeNotifier();
    expect(() => new ErrorRateMonitor(notifier, { threshold: 0, windowMs: 1, cooldownMs: 0 })).toThrow();
    expect(() => new ErrorRateMonitor(notifier, { threshold: 1, windowMs: 0, cooldownMs: 0 })).toThrow();
    expect(() => new ErrorRateMonitor(notifier, { threshold: 1, windowMs: 1, cooldownMs: -1 })).toThrow();
  });
});
