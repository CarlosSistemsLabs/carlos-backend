import type {
  PaginatedResult,
  PaginationParams,
  SortDirection,
  UUID,
} from '@shared/types/index.js';
import type { Customer } from '../entities/customer.js';

/** Optional filters for {@link ICustomerRepository.findMany}. */
export interface CustomerFilters {
  /** Restrict by active status. */
  isActive?: boolean;
  /** Case-insensitive partial match across name, email, phone and tax id. */
  search?: string;
}

/** Fields a customer listing may be ordered by. */
export type CustomerSortField = 'name' | 'email' | 'createdAt' | 'updatedAt';

/** Sort specification for a customer listing. */
export interface CustomerSort {
  field: CustomerSortField;
  direction: SortDirection;
}

/** Combined query for paginated customer listings. */
export interface CustomerQuery extends PaginationParams {
  filters?: CustomerFilters;
  /** Optional ordering; the repository applies a stable default when omitted. */
  sort?: CustomerSort;
}

/**
 * Persistence abstraction for {@link Customer} aggregates.
 *
 * Customers are tenant-scoped, so reads that resolve by contact detail take the
 * tenant explicitly and the per-tenant email/phone uniqueness invariants are
 * enforced here via {@link existsByEmail}/{@link existsByPhone}. The concrete
 * implementation lives in the infrastructure layer; the domain depends only on
 * this port (Clean Architecture, Requirement 3.2). It is Prisma-free.
 */
export interface ICustomerRepository {
  /** Finds a customer by id (excluding soft-deleted), or `null`. */
  findById(id: UUID): Promise<Customer | null>;

  /** Finds a customer by their (normalised) email for a tenant, or `null`. */
  findByEmail(tenantId: UUID, email: string): Promise<Customer | null>;

  /** Finds a customer by their (normalised) phone for a tenant, or `null`. */
  findByPhone(tenantId: UUID, phone: string): Promise<Customer | null>;

  /** Returns a paginated, filtered page of customers for a tenant. */
  findMany(tenantId: UUID, query: CustomerQuery): Promise<PaginatedResult<Customer>>;

  /** Persists a new customer. */
  create(customer: Customer): Promise<Customer>;

  /** Persists changes to an existing customer. */
  update(customer: Customer): Promise<Customer>;

  /** Soft-deletes a customer by stamping `deletedAt` (Requirement 9.4). */
  softDelete(id: UUID): Promise<void>;

  /**
   * Returns `true` when a customer with the given email already exists for the
   * tenant. `excludeId` skips a specific customer so updates do not collide with
   * themselves. Backs the per-tenant email-uniqueness invariant.
   */
  existsByEmail(tenantId: UUID, email: string, excludeId?: UUID): Promise<boolean>;

  /**
   * Returns `true` when a customer with the given phone already exists for the
   * tenant. `excludeId` skips a specific customer so updates do not collide with
   * themselves. Backs the per-tenant phone-uniqueness invariant.
   */
  existsByPhone(tenantId: UUID, phone: string, excludeId?: UUID): Promise<boolean>;
}
