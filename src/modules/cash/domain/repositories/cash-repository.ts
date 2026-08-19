import type { PaginatedResult, PaginationParams, UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import type { Cash } from '../entities/cash.js';

/** Optional filters for {@link ICashRepository.findByTenant}. */
export interface CashFilters {
  /** Restrict to a single branch (`null` matches registers with no branch). */
  branchId?: UUID | null;
}

/** Combined query for paginated cash-register listings. */
export interface CashQuery extends PaginationParams {
  filters?: CashFilters;
}

/**
 * Persistence abstraction for {@link Cash} registers (Requirement 9.1).
 *
 * Registers are tenant-scoped. The `Cash` model has no soft-delete column, so
 * there is no `softDelete`; the domain depends only on this port and the
 * transaction mechanism lives in infrastructure (Clean Architecture,
 * Requirement 3.2).
 */
export interface ICashRepository {
  /** Finds a register by id, or `null` when it does not exist. */
  findById(id: UUID): Promise<Cash | null>;

  /** Returns a paginated page of a tenant's registers, optionally filtered. */
  findByTenant(tenantId: UUID, query: CashQuery): Promise<PaginatedResult<Cash>>;

  /** Persists a new register. */
  create(cash: Cash): Promise<Cash>;

  /** Updates only the on-hand balance of an existing register. */
  updateBalance(id: UUID, balance: Money): Promise<void>;

  /** Upserts the full register (name/branch/balance) from the aggregate. */
  save(cash: Cash): Promise<Cash>;
}
