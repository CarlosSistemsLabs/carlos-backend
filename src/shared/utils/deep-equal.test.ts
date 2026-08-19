import { describe, it, expect } from 'vitest';
import { deepEqual } from './deep-equal.js';

describe('deepEqual', () => {
  it('compares primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, false)).toBe(false);
    expect(deepEqual(1, '1')).toBe(false);
  });

  it('treats NaN as equal to NaN', () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it('compares null and undefined distinctly', () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('compares nested objects regardless of key order', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('compares arrays by order and length', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('does not treat an array as equal to an object', () => {
    expect(deepEqual([], {})).toBe(false);
  });

  it('compares Date values by timestamp', () => {
    expect(
      deepEqual(new Date('2024-01-01'), new Date('2024-01-01')),
    ).toBe(true);
    expect(
      deepEqual(new Date('2024-01-01'), new Date('2024-01-02')),
    ).toBe(false);
  });
});
