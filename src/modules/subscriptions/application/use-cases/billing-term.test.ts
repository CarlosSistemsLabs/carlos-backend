import { describe, it, expect } from 'vitest';
import { addMonths, computeTermEnd } from './billing-term.js';

describe('addMonths', () => {
  it('adds a month within the same year', () => {
    expect(addMonths(new Date('2025-01-10T00:00:00.000Z'), 1).toISOString()).toBe(
      '2025-02-10T00:00:00.000Z',
    );
  });

  it('rolls over the year boundary', () => {
    expect(addMonths(new Date('2025-12-15T00:00:00.000Z'), 1).toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  it('clamps the day for a shorter target month (Jan 31 + 1 → Feb 28)', () => {
    expect(addMonths(new Date('2025-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2025-02-28T00:00:00.000Z',
    );
  });

  it('clamps to Feb 29 in a leap year', () => {
    expect(addMonths(new Date('2024-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('adds 12 months for a year', () => {
    expect(addMonths(new Date('2025-01-10T00:00:00.000Z'), 12).toISOString()).toBe(
      '2026-01-10T00:00:00.000Z',
    );
  });
});

describe('computeTermEnd', () => {
  const start = new Date('2025-03-05T12:00:00.000Z');

  it('adds one month for a monthly cycle', () => {
    expect(computeTermEnd(start, 'monthly').toISOString()).toBe('2025-04-05T12:00:00.000Z');
  });

  it('adds one year for a yearly cycle', () => {
    expect(computeTermEnd(start, 'yearly').toISOString()).toBe('2026-03-05T12:00:00.000Z');
  });
});
