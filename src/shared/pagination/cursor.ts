/**
 * Reusable, framework-agnostic cursor (keyset) pagination primitives
 * (Requirement 26.6, task 39.3).
 *
 * Cursor pagination is the scalable alternative to offset pagination for large,
 * append-heavy datasets (e.g. audit trails): instead of `OFFSET n` — which
 * forces the database to scan and discard `n` rows and drifts as rows are
 * inserted — the client passes back an opaque cursor identifying the last row
 * it saw, and the next page continues immediately after it. This keeps page
 * fetches O(pageSize) regardless of how deep into the dataset the client is.
 *
 * The cursor is **opaque**: callers must treat it as a black box and only ever
 * echo back a value this module produced. Internally it is a base64url-encoded
 * JSON payload carrying the sort/identity key(s) needed to resume the scan.
 * Encoding (rather than exposing a raw id) lets the payload evolve without
 * changing the public contract and discourages clients from constructing
 * cursors by hand.
 *
 * Kept dependency-free so the domain/application layers may import it (Clean
 * Architecture, Requirement 3.2).
 */

import { PAGINATION } from '../constants/index.js';

/**
 * Decoded cursor payload. Carries the stable identity of the last row on the
 * previous page; a repository resumes the keyset scan strictly after this id
 * (using a stable `orderBy` whose final tie-breaker is that same id).
 */
export interface CursorPayload {
  /** The id of the last row on the previous page. */
  id: string;
}

/** Client-supplied cursor pagination request. */
export interface CursorPaginationParams {
  /** Opaque cursor from a previous page; absent/empty means "first page". */
  cursor?: string;
  /** Requested page size, clamped to the platform bounds by {@link normalizeCursorLimit}. */
  limit?: number;
}

/**
 * A single page of cursor-paginated results.
 *
 * `nextCursor` is `null` on the last page (no more rows). `hasMore` mirrors
 * `nextCursor !== null` and is provided for ergonomic client checks.
 */
export interface CursorPage<T> {
  items: T[];
  /** Opaque cursor to fetch the next page, or `null` when the last page was reached. */
  nextCursor: string | null;
  /** `true` when a further page exists (equivalent to `nextCursor !== null`). */
  hasMore: boolean;
}

/**
 * Encodes a cursor payload into an opaque base64url token.
 *
 * base64url (rather than plain base64) keeps the token URL/query-string safe
 * without percent-encoding.
 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor token back into its payload.
 *
 * Returns `null` for any malformed input — undefined/empty, non-base64url, not
 * JSON, or missing a string `id`. Callers treat a `null` result as "no cursor"
 * (start from the first page) rather than surfacing an error, so a stale or
 * tampered cursor degrades gracefully instead of failing the request.
 */
export function decodeCursor(cursor: string | undefined | null): CursorPayload | null {
  if (cursor === undefined || cursor === null || cursor.length === 0) {
    return null;
  }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as { id: unknown }).id === 'string' &&
      (parsed as { id: string }).id.length > 0
    ) {
      return { id: (parsed as { id: string }).id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clamps a client-supplied cursor page size to the platform bounds
 * (Requirement 26.5): default 20, minimum 1, maximum 100. Non-finite or
 * out-of-range values are coerced to the nearest valid value rather than
 * rejected, mirroring the offset-pagination normalizer.
 */
export function normalizeCursorLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return PAGINATION.DEFAULT_PAGE_SIZE;
  }
  const floored = Math.floor(limit);
  if (floored < PAGINATION.MIN_PAGE_SIZE) {
    return PAGINATION.MIN_PAGE_SIZE;
  }
  if (floored > PAGINATION.MAX_PAGE_SIZE) {
    return PAGINATION.MAX_PAGE_SIZE;
  }
  return floored;
}

/**
 * Builds a {@link CursorPage} from an over-fetched row set.
 *
 * The repository is expected to fetch `limit + 1` rows: the extra row is the
 * "look-ahead" that reveals whether a further page exists WITHOUT a separate
 * `count` query. When more than `limit` rows come back, the surplus is dropped
 * and the next cursor is derived from the last KEPT row; otherwise this was the
 * final page and `nextCursor` is `null`.
 *
 * @param rows   Rows returned by the query, fetched with `take = limit + 1`.
 * @param limit  The page size that was requested (already normalized).
 * @param getId  Extracts the stable id used to build the next cursor.
 */
export function buildCursorPage<T>(
  rows: readonly T[],
  limit: number,
  getId: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows.slice();
  const last = items[items.length - 1];
  const nextCursor = hasMore && last !== undefined ? encodeCursor({ id: getId(last) }) : null;
  return { items, nextCursor, hasMore };
}
