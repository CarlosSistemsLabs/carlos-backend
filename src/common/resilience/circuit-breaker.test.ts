import { describe, it, expect, vi } from 'vitest';
import { DomainError, ErrorCode } from '@domain/errors/index.js';
import {
  CircuitBreaker,
  CircuitOpenError,
  CircuitState,
  type CircuitBreakerClock,
} from './circuit-breaker.js';

/**
 * Deterministic, manually-advanced clock (milliseconds) so cooldown behaviour is
 * exercised with NO real waiting (mirrors the AI layer's injected clock/timer).
 */
function fakeClock(start = 0): CircuitBreakerClock & { advance: (ms: number) => void } {
  let now = start;
  const clock = ((): number => now) as CircuitBreakerClock & { advance: (ms: number) => void };
  clock.advance = (ms: number): void => {
    now += ms;
  };
  return clock;
}

/** An operation that always rejects, so we can drive the breaker to OPEN. */
const failing = (): Promise<never> => Promise.reject(new Error('boom'));
/** An operation that always resolves with a fixed value. */
const succeeding = <T>(value: T): (() => Promise<T>) => (): Promise<T> => Promise.resolve(value);

describe('CircuitBreaker', () => {
  describe('construction validation', () => {
    it('rejects non-positive / non-integer thresholds and timeouts', () => {
      expect(() => new CircuitBreaker({ failureThreshold: 0 })).toThrow();
      expect(() => new CircuitBreaker({ failureThreshold: 1.5 })).toThrow();
      expect(() => new CircuitBreaker({ successThreshold: 0 })).toThrow();
      expect(() => new CircuitBreaker({ resetTimeoutMs: 0 })).toThrow();
      expect(() => new CircuitBreaker({ halfOpenMaxCalls: -1 })).toThrow();
    });

    it('defaults to a failure threshold of 5 (Requirement 27.3)', async () => {
      const breaker = new CircuitBreaker();
      // Four failures must NOT trip the default breaker.
      for (let i = 0; i < 4; i += 1) {
        await expect(breaker.execute(failing)).rejects.toThrow('boom');
      }
      expect(breaker.state).toBe(CircuitState.Closed);
      // The fifth consecutive failure trips it.
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Open);
    });
  });

  describe('CLOSED → OPEN', () => {
    it('trips to OPEN after exactly `failureThreshold` consecutive failures', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Closed);

      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Open);
    });

    it('propagates the original operation error while CLOSED (transparent wrapper)', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 });
      const original = new Error('specific failure');
      await expect(breaker.execute(() => Promise.reject(original))).rejects.toBe(original);
    });
  });

  describe('OPEN fast-rejects', () => {
    it('rejects with CircuitOpenError WITHOUT invoking the operation', async () => {
      const clock = fakeClock();
      const breaker = new CircuitBreaker({ failureThreshold: 1, clock, name: 'dep' });

      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Open);

      const op = vi.fn(succeeding('ok'));
      await expect(breaker.execute(op)).rejects.toBeInstanceOf(CircuitOpenError);
      expect(op).not.toHaveBeenCalled();
    });

    it('CircuitOpenError is a DomainError mapping to HTTP 503 with context', async () => {
      const clock = fakeClock();
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1_000,
        clock,
        name: 'ai:openai',
      });
      await expect(breaker.execute(failing)).rejects.toThrow('boom');

      const error = await breaker.execute(succeeding('x')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CircuitOpenError);
      expect(error).toBeInstanceOf(DomainError);
      const circuitError = error as CircuitOpenError;
      expect(circuitError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(circuitError.httpStatus).toBe(503);
      expect(circuitError.details).toMatchObject({ name: 'ai:openai', state: CircuitState.Open });
      expect(circuitError.details?.retryAfterMs).toBe(1_000);
    });

    it('does not count fast-rejected calls as operation invocations in metrics', async () => {
      const clock = fakeClock();
      const breaker = new CircuitBreaker({ failureThreshold: 1, clock });
      await expect(breaker.execute(failing)).rejects.toThrow('boom');

      await expect(breaker.execute(succeeding('x'))).rejects.toBeInstanceOf(CircuitOpenError);
      const metrics = breaker.getMetrics();
      expect(metrics.totalCalls).toBe(1); // only the initial failing call
      expect(metrics.rejectedCalls).toBe(1);
    });
  });

  describe('OPEN → HALF_OPEN → recovery / re-open', () => {
    it('moves to HALF_OPEN once the cooldown elapses, then CLOSES on a successful probe', async () => {
      const clock = fakeClock();
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 5_000,
        clock,
      });

      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Open);

      // Before cooldown: still OPEN, still fast-rejecting.
      clock.advance(4_999);
      expect(breaker.state).toBe(CircuitState.Open);
      await expect(breaker.execute(succeeding('x'))).rejects.toBeInstanceOf(CircuitOpenError);

      // After cooldown: state reads HALF_OPEN and a probe is admitted.
      clock.advance(1);
      expect(breaker.state).toBe(CircuitState.HalfOpen);

      let observedState: CircuitState | undefined;
      const result = await breaker.execute(() => {
        observedState = breaker.state;
        return Promise.resolve('recovered');
      });
      expect(result).toBe('recovered');
      expect(observedState).toBe(CircuitState.HalfOpen); // probe ran while half-open
      expect(breaker.state).toBe(CircuitState.Closed); // success closed the breaker
    });

    it('re-OPENs on a failed HALF_OPEN probe and restarts the cooldown', async () => {
      const clock = fakeClock();
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1_000,
        clock,
      });

      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      clock.advance(1_000);
      expect(breaker.state).toBe(CircuitState.HalfOpen);

      // Failed probe → back to OPEN, cooldown restarts from now.
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Open);

      clock.advance(999);
      expect(breaker.state).toBe(CircuitState.Open);
      clock.advance(1);
      expect(breaker.state).toBe(CircuitState.HalfOpen);
    });

    it('requires `successThreshold` consecutive successes to close from HALF_OPEN', async () => {
      const clock = fakeClock();
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        halfOpenMaxCalls: 2,
        resetTimeoutMs: 1_000,
        clock,
      });

      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      clock.advance(1_000);

      await breaker.execute(succeeding('a'));
      expect(breaker.state).toBe(CircuitState.HalfOpen); // 1 of 2 successes
      await breaker.execute(succeeding('b'));
      expect(breaker.state).toBe(CircuitState.Closed); // 2 of 2 → recovered
    });

    it('rejects probes beyond the HALF_OPEN concurrency budget', async () => {
      const clock = fakeClock();
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        halfOpenMaxCalls: 1,
        resetTimeoutMs: 1_000,
        clock,
      });
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      clock.advance(1_000);

      // Hold the first probe pending so the slot stays occupied.
      let release!: () => void;
      const pending = new Promise<string>((resolve) => {
        release = (): void => resolve('done');
      });
      const first = breaker.execute(() => pending);

      // Second concurrent probe is rejected fast.
      await expect(breaker.execute(succeeding('x'))).rejects.toBeInstanceOf(CircuitOpenError);

      release();
      await expect(first).resolves.toBe('done');
    });
  });

  describe('success in CLOSED resets the consecutive-failure count', () => {
    it('does not trip when failures are interleaved with successes', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.getMetrics().consecutiveFailures).toBe(2);

      await breaker.execute(succeeding('ok')); // resets the streak
      expect(breaker.getMetrics().consecutiveFailures).toBe(0);

      // Two more failures still do not trip (streak was reset).
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Closed);
    });
  });

  describe('isFailure predicate', () => {
    it('ignores errors the predicate deems non-failures (state untouched, error still thrown)', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        isFailure: (error) => !(error instanceof RangeError),
      });

      const ignored = new RangeError('client mistake');
      await expect(breaker.execute(() => Promise.reject(ignored))).rejects.toBe(ignored);
      expect(breaker.state).toBe(CircuitState.Closed);
      expect(breaker.getMetrics().totalFailures).toBe(0);
    });
  });

  describe('metrics + reset', () => {
    it('exposes cumulative counters and current state', async () => {
      const clock = fakeClock(1_000);
      const breaker = new CircuitBreaker({ failureThreshold: 2, clock, name: 'svc' });

      await breaker.execute(succeeding('a'));
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      await expect(breaker.execute(failing)).rejects.toThrow('boom'); // trips

      const metrics = breaker.getMetrics();
      expect(metrics.name).toBe('svc');
      expect(metrics.state).toBe(CircuitState.Open);
      expect(metrics.totalCalls).toBe(3);
      expect(metrics.totalSuccesses).toBe(1);
      expect(metrics.totalFailures).toBe(2);
      expect(metrics.openedAt).toBe(1_000);
      expect(metrics.lastFailureAt).toBe(1_000);
    });

    it('reset() returns the breaker to CLOSED and clears streak counters', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 });
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
      expect(breaker.state).toBe(CircuitState.Open);

      breaker.reset();
      expect(breaker.state).toBe(CircuitState.Closed);
      expect(breaker.getMetrics().consecutiveFailures).toBe(0);

      // It works normally again after reset.
      await expect(breaker.execute(succeeding('ok'))).resolves.toBe('ok');
    });
  });
});
