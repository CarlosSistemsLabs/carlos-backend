import type { UUID } from '@shared/types/index.js';
import type { CursorPage } from '@shared/pagination/cursor.js';
import type { StockMovement } from '../entities/stock-movement.js';
import type { StockMovementFilters } from './stock-movement-repository.js';

/**
 * Cursor (keyset) pagination query for the stock-movement audit history
 * (Requirement 26.6, task 39.3).
 *
 * The stock-movement table is append-only and grows unbounded, making it the
 * platform's clearest "large dataset" — the case cursor pagination exists for.
 * `limit` is the page size (already clamped to the platform bounds by the
 * caller); `cursor` is the opaque token from the previous page (absent for the
 * first page). The same {@link StockMovementFilters} as the offset listing are
 * supported so filtering behaviour is identical across both pagination styles.
 */
export interface StockMovementCursorQuery {
  /** Page size (clamped to the platform bounds before reaching the reader). */
  limit: number;
  /** Opaque cursor from a previous page; omit/undefined for the first page. */
  cursor?: string;
  filters?: StockMovementFilters;
}

/**
 * A narrow, additive read port exposing cursor-based access to the movement
 * audit trail, kept SEPARATE from {@link import('./stock-movement-repository.js').IStockMovementRepository}
 * so adding cursor support does not force every existing implementation/fake to
 * change (the offset-based port is untouched). The Prisma repository implements
 * both ports; new consumers depend only on the capability they need
 * (Interface Segregation, Clean Architecture — Requirement 3.2).
 */
export interface IStockMovementCursorReader {
  /**
   * Returns a single cursor page of movements for a tenant, newest-first with a
   * stable `id` tie-breaker so ordering is deterministic across pages even when
   * many rows share a `createdAt`. Tenant scope is always applied
   * (Requirement 1.5).
   */
  findManyByCursor(
    tenantId: UUID,
    query: StockMovementCursorQuery,
  ): Promise<CursorPage<StockMovement>>;
}
