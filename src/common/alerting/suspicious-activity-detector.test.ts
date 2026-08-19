import { describe, it, expect, vi } from 'vitest';
import { SuspiciousActivityDetector } from './suspicious-activity-detector.js';
import type { IAlertNotifier } from './alert.js';

function makeNotifier(): IAlertNotifier & { sendAlert: ReturnType<typeof vi.fn> } {
  return { sendAlert: vi.fn() };
}

function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('SuspiciousActivityDetector', () => {
  it('fires when N signals for the same key occur within the window', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    const detector = new SuspiciousActivityDetector(notifier, {
      threshold: 3,
      windowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    detector.record({ kind: 'failed_login', key: 'attacker@example.com' });
    clock.advance(1000);
    detector.record({ kind: 'failed_login', key: 'attacker@example.com' });
    expect(notifier.sendAlert).not.toHaveBeenCalled();
    clock.advance(1000);
    detector.record({ kind: 'failed_login', key: 'attacker@example.com' });

    expect(notifier.sendAlert).toHaveBeenCalledTimes(1);
    const alert = notifier.sendAlert.mock.calls[0]?.[0];
    expect(alert.severity).toBe('critical');
    expect(alert.context).toMatchObject({
      kind: 'failed_login',
      key: 'attacker@example.com',
      count: 3,
      threshold: 3,
    });
  });

  it('tracks each (kind, key) group independently', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    const detector = new SuspiciousActivityDetector(notifier, {
      threshold: 2,
      windowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    detector.record({ kind: 'failed_login', key: 'a@example.com' });
    detector.record({ kind: 'failed_login', key: 'b@example.com' });
    // Neither key has crossed the threshold on its own.
    expect(notifier.sendAlert).not.toHaveBeenCalled();

    detector.record({ kind: 'failed_login', key: 'a@example.com' }); // a reaches 2
    expect(notifier.sendAlert).toHaveBeenCalledTimes(1);
    expect(detector.countFor('failed_login', 'a@example.com')).toBe(2);
    expect(detector.countFor('failed_login', 'b@example.com')).toBe(1);
  });

  it('does not fire when signals fall outside the rolling window', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    const detector = new SuspiciousActivityDetector(notifier, {
      threshold: 3,
      windowMs: 5000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    detector.record({ kind: 'failed_login', key: 'x@example.com' });
    clock.advance(3000);
    detector.record({ kind: 'failed_login', key: 'x@example.com' });
    clock.advance(3000); // first signal (t=0) now older than 5000ms window
    detector.record({ kind: 'failed_login', key: 'x@example.com' });

    expect(notifier.sendAlert).not.toHaveBeenCalled();
    expect(detector.countFor('failed_login', 'x@example.com')).toBe(2);
  });

  it('respects a per-key cooldown', () => {
    const notifier = makeNotifier();
    const clock = makeClock();
    // Window is wide enough to retain hits across the cooldown so the cooldown
    // (not the sliding window) is what governs re-alerting.
    const detector = new SuspiciousActivityDetector(notifier, {
      threshold: 2,
      windowMs: 1_000_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    detector.record({ kind: 'failed_login', key: 'k@example.com' });
    detector.record({ kind: 'failed_login', key: 'k@example.com' }); // alert #1
    expect(notifier.sendAlert).toHaveBeenCalledTimes(1);

    clock.advance(1000); // within cooldown
    detector.record({ kind: 'failed_login', key: 'k@example.com' });
    expect(notifier.sendAlert).toHaveBeenCalledTimes(1);

    clock.advance(300_000); // cooldown elapsed
    detector.record({ kind: 'failed_login', key: 'k@example.com' });
    expect(notifier.sendAlert).toHaveBeenCalledTimes(2);
  });
});
