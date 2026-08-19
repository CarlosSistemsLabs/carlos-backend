import type { Nullable, PaginatedResult, PaginationParams, UUID } from '@shared/types/index.js';
import type { Stock } from '../entities/stock.js';

/**
 * A stock balance enriched with the owning product's catalogue data required
 * to evaluate a low-stock alert. Returned by listing queries so the
 * application layer can compute the `lowStock` flag (`quantity <= minStock`)
 * without reaching into the Products module.
 */
export interface StockLevelView {
  stock: Stock;
  /** The product's display name, for presentation. */
  productName: string;
  /** The product's configured low-stock threshold (`Product.minStock`). */
  minStock: number;
}

/** Optional filters for {@link IStockRepository.findByTenant}. */
export interface StockLevelFilters {
  /** Restrict to a single product. */
  productId?: UUID;
  /**
   * Restrict to a single branch. Pass `null` to match the tenant-wide balance
   * (rows whose `branchId IS NULL`); omit to match every branch.
   */
  branchId?: Nullable<UUID>;
}

/** Combined query for a paginated stock-level listing. */
export interface StockLevelQuery extends PaginationParams {
  filters?: StockLevelFilters;
}

/**
 * Persistence abstraction for {@link Stock} aggregates.
 *
 * Stock is tenant-scoped with one balance per `(tenantId, productId, branchId)`
 * triple. The concrete implementation lives in the infrastructure layer; the
 * domain depends only on this port (Clean Architecture, Requirement 3.2).
 */
export interface IStockRepository {
  /**
   * Finds the balance for a product at a branch (`branchId === null` matches
   * the tenant-wide balance), or `null` when none exists yet.
   */
  findByProductBranch(
    tenantId: UUID,
    productId: UUID,
    branchId: Nullable<UUID>,
  ): Promise<Stock | null>;

  /**
   * Returns a paginated page of stock levels for a tenant, each enriched with
   * the product name and `minStock` threshold for low-stock evaluation.
   */
  findByTenant(tenantId: UUID, query: StockLevelQuery): Promise<PaginatedResult<StockLevelView>>;

  /**
   * Returns only the balances that are at or below their product's `minStock`
   * threshold (`quantity <= minStock`), paginated. The threshold comparison is
   * resolved by joining `Product.minStock`.
   */
  findLowStock(tenantId: UUID, query: StockLevelQuery): Promise<PaginatedResult<StockLevelView>>;

  /**
   * Inserts or updates a stock balance. Implementations upsert by the
   * aggregate's stable `id` so a freshly-created balance is inserted and an
   * existing one has its quantity updated.
   */
  save(stock: Stock): Promise<Stock>;
}
