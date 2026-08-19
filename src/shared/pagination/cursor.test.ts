import { describe, expect, it } from 'vitest';
import {
  buildCursorPage,
  decodeCursor,
  encodeCursor,
  normalizeCursorLimit,
  type CursorPayload,
} from './cursor.js';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a payload (decode(encode(x)) === x)', () => {
    const payload: CursorPayload = { id: 'mov-42' };
    const token = encodeCursor(payload);
    expect(decodeCursor(token)).toEqual(payload);
  });

  it('produces a URL-safe token (no +, / or = padding)', () => {
    // A UUID-ish id exercises characters that would base64-encode to +/=.
    const token = encodeCursor({ id: '00000000-ffff-4fff-bfff-fffffffffffe' });
    expect(token).not.toMatch(/[+/=]/);
    expect(decodeCursor(token)).toEqual({ id: '00000000-ffff-4fff-bfff-fffffffffffe' });
  });

  it('returns null for undefined, null or empty cursors', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for a malformed (non-JSON) token', () => {
    expect(decodeCursor('not-a-valid-cursor!!!')).toBeNull();
  });

  it('returns null when the decoded payload lacks a string id', () => {
    expect(decodeCursor(Buffer.from('{"foo":1}', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"id":123}', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"id":""}', 'utf8').toString('base64url'))).toBeNull();
  });
});

describe('normalizeCursorLimit', () => {
  it('defaults to the platform page size when omitted or non-finite', () => {
    expect(normalizeCursorLimit(undefined)).toBe(20);
    expect(normalizeCursorLimit(Number.NaN)).toBe(20);
    expect(normalizeCursorLimit(Number.POSITIVE_INFINITY)).toBe(20);
  });

  it('clamps below the minimum and above the maximum', () => {
    expect(normalizeCursorLimit(0)).toBe(1);
    expect(normalizeCursorLimit(-10)).toBe(1);
    expect(normalizeCursorLimit(5000)).toBe(100);
  });

  it('floors fractional values and passes valid ones through', () => {
    expect(normalizeCursorLimit(20.9)).toBe(20);
    expect(normalizeCursorLimit(50)).toBe(50);
  });
});

describe('buildCursorPage', () => {
  interface Row {
    id: string;
  }
  const getId = (row: Row): string => row.id;

  it('derives the next cursor from the last kept row when more rows exist', () => {
    // limit 2, over-fetched 3 rows -> a further page exists.
    const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = buildCursorPage(rows, 2, getId);

    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    // The next cursor resumes strictly after the last kept row ('b'), not the
    // dropped look-ahead row ('c').
    expect(decodeCursor(page.nextCursor)).toEqual({ id: 'b' });
  });

  it('marks the last page with no next cursor when rows fit within the limit', () => {
    const rows: Row[] = [{ id: 'a' }, { id: 'b' }];
    const page = buildCursorPage(rows, 2, getId);

    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result set', () => {
    const page = buildCursorPage<Row>([], 20, getId);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
