import type { PaginatedResult, PaginationParams, UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import type { CashMovement } from '../entities/cash-movement.js';
import type { CashMovementType } from '../value-objects/cash-movement-type.js';
import type { CashMovementCategory } from '../value-objects/cash-movement-category.js';

/** Optional filters for {@link ICashMovementRepository.findMany}. */
export interface CashMovementFilters {
  /** Restrict to a single register. */
  cashId?: UUID;
  /** Restrict by direction (`INCOME` / `EXPENSE`). */
  type?: CashMovementType;
  /** Restrict by business category (`sale`, `opening`, …). */
  category?: CashMovementCategory;
  /** Inclusive lower bound on `date`. */
  from?: Date;
  /** Inclusive upper bound on `date`. */
  to?: Date;
}

/** Combined query for paginated movement listings. */
export interface CashMovementQuery extends PaginationParams {
  filters?: CashMovementFilters;
}

/**
 * Persistence abstraction for {@link CashMovement}s (Requirement 9.1).
 *
 * The movement ledger is append-only, so only {@link create}, read and
 * aggregate methods are exposed. {@link sumByCash} returns the net signed total
 * of a register's movements (`INCOME` positive, `EXPENSE` negative), which the
 * close reconciliation uses to derive the expected balance from the ledger.
 */
export interface ICashMovementRepository {
  /** Appends a movement to the ledger. */
  create(movement: CashMovement): Promise<CashMovement>;

  /** Returns a paginated, filtered page of a tenant's movements. */
  findMany(tenantId: UUID, query: CashMovementQuery): Promise<PaginatedResult<CashMovement>>;

  /**
   * Returns the net signed sum of a register's movements as {@link Money}
   * (`INCOME` credited, `EXPENSE` debited). Used to reconcile the ledger against
   * the stored balance at close time.
   */
  sumByCash(tenantId: UUID, cashId: UUID, currency: string): Promise<Money>;
}
