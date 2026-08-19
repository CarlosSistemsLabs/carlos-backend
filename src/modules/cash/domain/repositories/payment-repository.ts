import type { PaginatedResult, PaginationParams, UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import type { Payment } from '../entities/payment.js';
import type { PaymentMethod } from '../value-objects/payment-method.js';

/** Optional filters for {@link IPaymentRepository.findMany}. */
export interface PaymentFilters {
  /** Restrict to payments settling a single sale. */
  saleId?: UUID;
  /** Restrict to payments settling a single purchase. */
  purchaseId?: UUID;
  /** Restrict by tender (`cash`, `card`, …). */
  method?: PaymentMethod;
  /** Inclusive lower bound on `date`. */
  from?: Date;
  /** Inclusive upper bound on `date`. */
  to?: Date;
}

/** Combined query for paginated payment listings. */
export interface PaymentQuery extends PaginationParams {
  filters?: PaymentFilters;
}

/**
 * Persistence abstraction for {@link Payment}s (Requirement 9.1).
 *
 * Payments are tenant-scoped and immutable, so only {@link create} and read
 * methods are exposed. The domain depends only on this port (Clean
 * Architecture, Requirement 3.2). `RecordPaymentUseCase` (task 23.2) drives
 * {@link create}.
 */
export interface IPaymentRepository {
  /** Persists a new payment. */
  create(payment: Payment): Promise<Payment>;

  /** Returns a paginated, filtered page of a tenant's payments. */
  findMany(tenantId: UUID, query: PaymentQuery): Promise<PaginatedResult<Payment>>;

  /**
   * Returns the total already paid against a single sale as {@link Money} (zero
   * when the sale has no payments). Drives the outstanding-balance and
   * payment-status calculations without loading every payment row.
   */
  sumBySale(tenantId: UUID, saleId: UUID, currency: string): Promise<Money>;

  /**
   * Returns the total already paid against a single purchase as {@link Money}
   * (zero when the purchase has no payments). The purchase-side mirror of
   * {@link sumBySale}.
   */
  sumByPurchase(tenantId: UUID, purchaseId: UUID, currency: string): Promise<Money>;
}
