import type {
  Nullable,
  PaginatedResult,
  PaginationParams,
  SortDirection,
  UUID,
} from '@shared/types/index.js';
import type { Sale } from '../entities/sale.js';
import type { SaleStatus } from '../value-objects/sale-status.js';

/** Optional filters for {@link ISaleRepository.findMany}. */
export interface SaleFilters {
  /** Restrict to a single customer. */
  customerId?: UUID;
  /** Restrict to a single branch (`null` matches sales with no branch). */
  branchId?: Nullable<UUID>;
  /** Restrict by lifecycle status. */
  status?: SaleStatus;
  /** Inclusive lower bound on `saleDate`. */
  from?: Date;
  /** Inclusive upper bound on `saleDate`. */
  to?: Date;
}

/** Fields a sale listing may be ordered by. */
export type SaleSortField = 'saleDate' | 'saleNumber' | 'total' | 'createdAt';

/** Sort specification for a sale listing. */
export interface SaleSort {
  field: SaleSortField;
  direction: SortDirection;
}

/** Combined query for paginated sale listings. */
export interface SaleQuery extends PaginationParams {
  filters?: SaleFilters;
  /** Optional ordering; the repository applies a stable default when omitted. */
  sort?: SaleSort;
}

/**
 * Persistence abstraction for {@link Sale} aggregates (Requirement 9.1).
 *
 * Sales are tenant-scoped. Because a sale and its line items must be inserted
 * together, {@link create} persists the whole aggregate atomically (the
 * concrete implementation nests the `SaleDetail` inserts in the same write, run
 * inside a transaction via {@link ISaleUnitOfWork}). The domain depends only on
 * this port; the transaction mechanism stays in infrastructure (Clean
 * Architecture, Requirement 3.2).
 */
export interface ISaleRepository {
  /** Finds a sale (with its lines) by id, excluding soft-deleted, or `null`. */
  findById(id: UUID): Promise<Sale | null>;

  /** Returns a paginated, filtered page of sales for a tenant. */
  findMany(tenantId: UUID, query: SaleQuery): Promise<PaginatedResult<Sale>>;

  /** Persists a new sale together with all of its line items, atomically. */
  create(sale: Sale): Promise<Sale>;

  /** Updates only the lifecycle status of an existing sale. */
  updateStatus(id: UUID, status: SaleStatus): Promise<void>;

  /** Soft-deletes a sale by stamping `deletedAt` (Requirement 9.4). */
  softDelete(id: UUID): Promise<void>;

  /**
   * Returns the next sequential sale number for a tenant, formatted
   * `SALE-000001`.
   *
   * **Strategy + trade-off:** the number is derived from the current count of a
   * tenant's sales (`count + 1`). This is simple and readable but is *not*
   * race-free under concurrency — two simultaneous creations can compute the
   * same next value. Two mitigations apply: (1) callers invoke this **inside
   * the create transaction** ({@link ISaleUnitOfWork}) so the window is small,
   * and (2) the `@@unique([tenantId, saleNumber])` constraint is the final
   * authority — a colliding insert fails and can be retried. Production
   * hardening (a dedicated per-tenant DB sequence or `SELECT … FOR UPDATE` on a
   * counter row) is deferred as a follow-up.
   */
  nextSaleNumber(tenantId: UUID): Promise<string>;
}
