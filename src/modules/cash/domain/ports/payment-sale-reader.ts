import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/** The authoritative billed total of a sale, read when settling it. */
export interface PaymentSaleTotal {
  saleId: UUID;
  /** Current `Sale.total` as a {@link Money} value (tenant base currency). */
  total: Money;
}

/**
 * Output port the Cash module uses to read a sale's authoritative **total**
 * when recording a payment (Requirement 9.1).
 *
 * Recording a payment and deriving a payment status both need the sale's billed
 * total to compute the outstanding balance (`total - alreadyPaid`). Rather than
 * importing the Sales module internals across the module boundary, the Cash
 * module declares this port and infrastructure implements it against the
 * `Sale`/Prisma layer, reading the `total` column (Dependency Inversion, Clean
 * Architecture Requirement 3.2).
 */
export interface IPaymentSaleReader {
  /**
   * Returns the sale's total, or `null` when no (non-deleted) sale with
   * `saleId` exists for the tenant — the caller turns `null` into a 404.
   */
  getTotal(tenantId: UUID, saleId: UUID): Promise<PaymentSaleTotal | null>;
}
