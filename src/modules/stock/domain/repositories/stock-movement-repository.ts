import type { Nullable, PaginatedResult, PaginationParams, UUID } from '@shared/types/index.js';
import type { StockMovement } from '../entities/stock-movement.js';
import type { StockMovementType } from '../value-objects/stock-movement-type.js';

/** Optional filters for {@link IStockMovementRepository.findMany}. */
export interface StockMovementFilters {
  /** Restrict to a single product. */
  productId?: UUID;
  /** Restrict to a single branch, or `null` for tenant-wide movements. */
  branchId?: Nullable<UUID>;
  /** Restrict to a single movement type. */
  type?: StockMovementType;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date;
  /** Inclusive upper bound on `createdAt`. */
  to?: Date;
}

/** Combined query for a paginated movement listing. */
export interface StockMovementQuery extends PaginationParams {
  filters?: StockMovementFilters;
}

/**
 * Persistence abstraction for {@link StockMovement} audit records.
 *
 * Movements are append-only: the port exposes {@link create} and read methods
 * but no update/delete, mirroring the immutable nature of the audit trail. The
 * concrete implementation lives in the infrastructure layer (Clean
 * Architecture, Requirement 3.2).
 */
export interface IStockMovementRepository {
  /** Appends a movement to the audit trail. */
  create(movement: StockMovement): Promise<StockMovement>;

  /** Returns a paginated, filtered page of movements for a tenant (newest first). */
  findMany(
    tenantId: UUID,
    query: StockMovementQuery,
  ): Promise<PaginatedResult<StockMovement>>;
}
