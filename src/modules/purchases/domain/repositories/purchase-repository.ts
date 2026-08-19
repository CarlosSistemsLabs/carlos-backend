import type {
  PaginatedResult,
  PaginationParams,
  SortDirection,
  UUID,
} from '@shared/types/index.js';
import type { Purchase } from '../entities/purchase.js';
import type { PurchaseStatus } from '../value-objects/purchase-status.js';

/** Optional filters for {@link IPurchaseRepository.findMany}. */
export interface PurchaseFilters {
  /** Restrict to a single supplier. */
  supplierId?: UUID;
  /** Restrict by lifecycle status. */
  status?: PurchaseStatus;
  /** Inclusive lower bound on `purchaseDate`. */
  from?: Date;
  /** Inclusive upper bound on `purchaseDate`. */
  to?: Date;
}

/** Fields a purchase listing may be ordered by. */
export type PurchaseSortField = 'purchaseDate' | 'purchaseNumber' | 'total' | 'createdAt';

/** Sort specification for a purchase listing. */
export interface PurchaseSort {
  field: PurchaseSortField;
  direction: SortDirection;
}

/** Combined query for paginated purchase listings. */
export interface PurchaseQuery extends PaginationParams {
  filters?: PurchaseFilters;
  /** Optional ordering; the repository applies a stable default when omitted. */
  sort?: PurchaseSort;
}

/**
 * Persistence abstraction for {@link Purchase} aggregates (Requirement 9.1, 10.3).
 *
 * Purchases are tenant-scoped. Because a purchase and its line items must be
 * inserted together, {@link create} persists the whole aggregate atomically
 * (the concrete implementation nests the `PurchaseDetail` inserts in the same
 * write, run inside a transaction via {@link IPurchaseUnitOfWork}). The domain
 * depends only on this port; the transaction mechanism stays in infrastructure
 * (Clean Architecture, Requirement 3.2).
 */
export interface IPurchaseRepository {
  /** Finds a purchase (with its lines) by id, excluding soft-deleted, or `null`. */
  findById(id: UUID): Promise<Purchase | null>;

  /** Returns a paginated, filtered page of purchases for a tenant. */
  findMany(tenantId: UUID, query: PurchaseQuery): Promise<PaginatedResult<Purchase>>;

  /** Persists a new purchase together with all of its line items, atomically. */
  create(purchase: Purchase): Promise<Purchase>;

  /** Updates only the lifecycle status of an existing purchase. */
  updateStatus(id: UUID, status: PurchaseStatus): Promise<void>;

  /** Soft-deletes a purchase by stamping `deletedAt` (Requirement 9.4). */
  softDelete(id: UUID): Promise<void>;

  /**
   * Returns the next sequential purchase number for a tenant, formatted
   * `PUR-000001`.
   *
   * **Strategy + trade-off:** the number is derived from the current count of a
   * tenant's purchases (`count + 1`). This is simple and readable but is *not*
   * race-free under concurrency — two simultaneous creations can compute the
   * same next value. Two mitigations apply: (1) callers invoke this **inside
   * the create transaction** ({@link IPurchaseUnitOfWork}) so the window is
   * small, and (2) the `@@unique([tenantId, purchaseNumber])` constraint is the
   * final authority — a colliding insert fails and can be retried. Production
   * hardening (a dedicated per-tenant DB sequence or `SELECT … FOR UPDATE` on a
   * counter row) is deferred as a follow-up.
   */
  nextPurchaseNumber(tenantId: UUID): Promise<string>;
}
