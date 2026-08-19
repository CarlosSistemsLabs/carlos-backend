import { describe, it, expect, vi } from 'vitest';
import { ValidationError, NotFoundError } from '@domain/errors/index.js';
import {
  retry,
  retryDatabaseOperation,
  retryExternalCall,
  defaultShouldRetry,
  computeBackoffDelay,
  getRetryAttempts,
  DEFAULT_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_BACKOFF_MULTIPLIER,
  type SleepFn,
} from './retry.js';

/**
 * Builds a fake {@link SleepFn} that records every requested delay and resolves
 * IMMEDIATELY — so backoff schedules are asserted without any real waiting.
 */
function createFakeSleep(): { sleep: SleepFn; delays: number[] } {
  const delays: number[] = [];
  const sleep: SleepFn = (ms: number): Promise<void> => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

/** A transient infrastructure error carrying a retryable `code`. */
class TransientError extends Error {
  constructor(public readonly code: string) {
    super(`transient: ${code}`);
    this.name = 'TransientError';
  }
}

describe('retry', () => {
  it('succeeds on the first try without retrying or sleeping', async () => {
    const { sleep, delays } = createFakeSleep();
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await retry(fn, { sleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('retries a transient failure and eventually succeeds within the budget', async () => {
    const { sleep, delays } = createFakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('ECONNRESET'))
      .mockRejectedValueOnce(new TransientError('ETIMEDOUT'))
      .mockResolvedValue('recovered');

    const result = await retry(fn, { sleep, attempts: 3 });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    // Two failures → two backoff waits.
    expect(delays).toHaveLength(2);
  });

  it('exhausts attempts then throws the LAST error and records attempt count', async () => {
    const { sleep, delays } = createFakeSleep();
    const first = new TransientError('ECONNRESET');
    const second = new TransientError('ETIMEDOUT');
    const last = new TransientError('EPIPE');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)
      .mockRejectedValueOnce(last);

    await expect(retry(fn, { sleep, attempts: 3 })).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
    // 3 attempts → 2 waits (no wait after the final failure).
    expect(delays).toHaveLength(2);
    expect(getRetryAttempts(last)).toBe(3);
  });

  it('follows the exponential backoff schedule (base, base*mult, base*mult^2)', async () => {
    const { sleep, delays } = createFakeSleep();
    const fn = vi.fn().mockRejectedValue(new TransientError('ECONNRESET'));

    await expect(
      retry(fn, {
        sleep,
        attempts: 4,
        baseDelayMs: 100,
        multiplier: 2,
        shouldRetry: () => true,
      }),
    ).rejects.toBeInstanceOf(TransientError);

    // 4 attempts → 3 waits following 100, 200, 400.
    expect(delays).toEqual([100, 200, 400]);
  });

  it('caps the backoff delay at maxDelayMs', async () => {
    const { sleep, delays } = createFakeSleep();
    const fn = vi.fn().mockRejectedValue(new TransientError('ECONNRESET'));

    await expect(
      retry(fn, {
        sleep,
        attempts: 5,
        baseDelayMs: 100,
        multiplier: 2,
        maxDelayMs: 250,
        shouldRetry: () => true,
      }),
    ).rejects.toBeInstanceOf(TransientError);

    // Raw schedule 100, 200, 400, 800 → capped to 100, 200, 250, 250.
    expect(delays).toEqual([100, 200, 250, 250]);
  });

  it('does not retry non-retryable domain errors (fails fast)', async () => {
    const { sleep, delays } = createFakeSleep();
    const validation = new ValidationError('bad input');
    const fn = vi.fn().mockRejectedValue(validation);

    await expect(retry(fn, { sleep, attempts: 3 })).rejects.toBe(validation);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('honors a custom shouldRetry predicate that declines to retry', async () => {
    const { sleep, delays } = createFakeSleep();
    const error = new Error('nope');
    const shouldRetry = vi.fn().mockReturnValue(false);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(retry(fn, { sleep, attempts: 3, shouldRetry })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(error, 1);
    expect(delays).toEqual([]);
  });

  it('invokes onRetry before each wait with the error, attempt and delay', async () => {
    const { sleep } = createFakeSleep();
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('ECONNRESET'))
      .mockResolvedValue('ok');

    await retry(fn, { sleep, attempts: 3, baseDelayMs: 50, multiplier: 2, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(TransientError), 1, 50);
  });

  it('clamps attempts below 1 to a single attempt', async () => {
    const { sleep, delays } = createFakeSleep();
    const error = new TransientError('ECONNRESET');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(retry(fn, { sleep, attempts: 0 })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('applies jitter within [1 - j, 1 + j) using the injected random source', async () => {
    const { sleep, delays } = createFakeSleep();
    // random() = 0 → factor = 1 - jitter (lower bound).
    const fn = vi.fn().mockRejectedValue(new TransientError('ECONNRESET'));

    await expect(
      retry(fn, {
        sleep,
        attempts: 2,
        baseDelayMs: 100,
        multiplier: 2,
        jitter: 0.5,
        random: () => 0,
        shouldRetry: () => true,
      }),
    ).rejects.toBeInstanceOf(TransientError);

    // 100 * (1 - 0.5) = 50.
    expect(delays).toEqual([50]);
  });
});

describe('defaultShouldRetry', () => {
  it('never retries domain errors', () => {
    expect(defaultShouldRetry(new ValidationError('x'), 1)).toBe(false);
    expect(defaultShouldRetry(NotFoundError.forEntity('Plan', 'id'), 1)).toBe(false);
  });

  it('retries known transient codes (Node + Prisma), case-insensitively', () => {
    expect(defaultShouldRetry(new TransientError('ECONNRESET'), 1)).toBe(true);
    expect(defaultShouldRetry(new TransientError('etimedout'), 1)).toBe(true);
    expect(defaultShouldRetry(new TransientError('P2024'), 1)).toBe(true);
    expect(defaultShouldRetry(new TransientError('p1001'), 1)).toBe(true);
  });

  it('does not retry a non-transient coded error', () => {
    expect(defaultShouldRetry(new TransientError('P2002'), 1)).toBe(false);
  });

  it('retries opaque errors with no code', () => {
    expect(defaultShouldRetry(new Error('boom'), 1)).toBe(true);
  });
});

describe('computeBackoffDelay', () => {
  const base = { baseDelayMs: 100, multiplier: 2, jitter: 0, random: () => 0 };

  it('grows geometrically with the retry index', () => {
    expect(computeBackoffDelay(0, base)).toBe(100);
    expect(computeBackoffDelay(1, base)).toBe(200);
    expect(computeBackoffDelay(2, base)).toBe(400);
  });

  it('respects maxDelayMs', () => {
    expect(computeBackoffDelay(5, { ...base, maxDelayMs: 250 })).toBe(250);
  });

  it('exports the documented defaults', () => {
    expect(DEFAULT_ATTEMPTS).toBe(3);
    expect(DEFAULT_BASE_DELAY_MS).toBe(100);
    expect(DEFAULT_BACKOFF_MULTIPLIER).toBe(2);
  });
});

describe('retryDatabaseOperation', () => {
  it('retries a transient DB error then succeeds', async () => {
    const { sleep, delays } = createFakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('P2024'))
      .mockResolvedValue('row');

    const result = await retryDatabaseOperation(fn, { sleep });

    expect(result).toBe('row');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(delays).toHaveLength(1);
  });

  it('does not retry a domain error', async () => {
    const { sleep } = createFakeSleep();
    const err = new NotFoundError('missing');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(retryDatabaseOperation(fn, { sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('retryExternalCall', () => {
  it('retries transient outbound failures within the budget', async () => {
    const { sleep, delays } = createFakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('ETIMEDOUT'))
      .mockResolvedValue('resp');

    const result = await retryExternalCall(fn, { sleep });

    expect(result).toBe('resp');
    expect(fn).toHaveBeenCalledTimes(2);
    // Default external base delay is 200ms.
    expect(delays).toEqual([200]);
  });
});
