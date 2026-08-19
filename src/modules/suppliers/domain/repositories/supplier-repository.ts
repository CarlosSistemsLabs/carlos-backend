import type {
  PaginatedResult,
  PaginationParams,
  SortDirection,
  UUID,
} from '@shared/types/index.js';
import type { Supplier } from '../entities/supplier.js';

/** Optional filters for {@link ISupplierRepository.findMany}. */
export interface SupplierFilters {
  /** Restrict by active status. */
  isActive?: boolean;
  /** Case-insensitive partial match across name, email, phone and tax id. */
  search?: string;
}

/** Fields a supplier listing may be ordered by. */
export type SupplierSortField = 'name' | 'email' | 'createdAt' | 'updatedAt';

/** Sort specification for a supplier listing. */
export interface SupplierSort {
  field: SupplierSortField;
  direction: SortDirection;
}

/** Combined query for paginated supplier listings. */
export interface SupplierQuery extends PaginationParams {
  filters?: SupplierFilters;
  /** Optional ordering; the repository applies a stable default when omitted. */
  sort?: SupplierSort;
}

/**
 * Persistence abstraction for {@link Supplier} aggregates.
 *
 * Suppliers are tenant-scoped, so reads that resolve by contact detail take the
 * tenant explicitly and the per-tenant email/phone uniqueness invariants are
 * enforced here via {@link existsByEmail}/{@link existsByPhone}. The concrete
 * implementation lives in the infrastructure layer; the domain depends only on
 * this port (Clean Architecture, Requirement 3.2). It is Prisma-free.
 */
export interface ISupplierRepository {
  /** Finds a supplier by id (excluding soft-deleted), or `null`. */
  findById(id: UUID): Promise<Supplier | null>;

  /** Finds a supplier by their (normalised) email for a tenant, or `null`. */
  findByEmail(tenantId: UUID, email: string): Promise<Supplier | null>;

  /** Finds a supplier by their (normalised) phone for a tenant, or `null`. */
  findByPhone(tenantId: UUID, phone: string): Promise<Supplier | null>;

  /** Returns a paginated, filtered page of suppliers for a tenant. */
  findMany(tenantId: UUID, query: SupplierQuery): Promise<PaginatedResult<Supplier>>;

  /** Persists a new supplier. */
  create(supplier: Supplier): Promise<Supplier>;

  /** Persists changes to an existing supplier. */
  update(supplier: Supplier): Promise<Supplier>;

  /** Soft-deletes a supplier by stamping `deletedAt` (Requirement 9.4). */
  softDelete(id: UUID): Promise<void>;

  /**
   * Returns `true` when a supplier with the given email already exists for the
   * tenant. `excludeId` skips a specific supplier so updates do not collide with
   * themselves. Backs the per-tenant email-uniqueness invariant.
   */
  existsByEmail(tenantId: UUID, email: string, excludeId?: UUID): Promise<boolean>;

  /**
   * Returns `true` when a supplier with the given phone already exists for the
   * tenant. `excludeId` skips a specific supplier so updates do not collide with
   * themselves. Backs the per-tenant phone-uniqueness invariant.
   */
  existsByPhone(tenantId: UUID, phone: string, excludeId?: UUID): Promise<boolean>;
}
