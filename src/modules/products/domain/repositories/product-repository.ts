import type {
  PaginatedResult,
  PaginationParams,
  SortDirection,
  UUID,
} from '@shared/types/index.js';
import type { Product } from '../entities/product.js';

/** Optional filters for {@link IProductRepository.findMany}. */
export interface ProductFilters {
  /** Restrict to a single category. */
  categoryId?: UUID;
  /** Restrict by active status. */
  isActive?: boolean;
  /** Case-insensitive partial match against product name or SKU. */
  search?: string;
}

/** Fields a product listing may be ordered by. */
export type ProductSortField = 'name' | 'sku' | 'price' | 'createdAt' | 'updatedAt';

/** Sort specification for a product listing. */
export interface ProductSort {
  field: ProductSortField;
  direction: SortDirection;
}

/** Combined query for paginated product listings. */
export interface ProductQuery extends PaginationParams {
  filters?: ProductFilters;
  /** Optional ordering; the repository applies a stable default when omitted. */
  sort?: ProductSort;
}

/**
 * Persistence abstraction for {@link Product} aggregates.
 *
 * Products are tenant-scoped (`@@unique([tenantId, sku])`), so reads that
 * resolve by SKU take the tenant explicitly and the SKU-uniqueness invariant is
 * enforced here via {@link existsBySku}. The concrete implementation lives in
 * the infrastructure layer; the domain depends only on this port
 * (Clean Architecture, Requirement 3.2).
 */
export interface IProductRepository {
  /** Finds a product by id (excluding soft-deleted), or `null`. */
  findById(id: UUID): Promise<Product | null>;

  /** Finds a product by its tenant-unique SKU (excluding soft-deleted), or `null`. */
  findBySku(tenantId: UUID, sku: string): Promise<Product | null>;

  /** Returns a paginated, filtered page of products for a tenant. */
  findMany(tenantId: UUID, query: ProductQuery): Promise<PaginatedResult<Product>>;

  /** Persists a new product. */
  create(product: Product): Promise<Product>;

  /** Persists changes to an existing product. */
  update(product: Product): Promise<Product>;

  /** Soft-deletes a product by stamping `deletedAt` (Requirement 9.4). */
  softDelete(id: UUID): Promise<void>;

  /**
   * Returns `true` when a product with the given SKU already exists for the
   * tenant. `excludeId` skips a specific product so updates do not collide with
   * themselves. Backs the per-tenant SKU-uniqueness invariant.
   */
  existsBySku(tenantId: UUID, sku: string, excludeId?: UUID): Promise<boolean>;
}
