import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/** The authoritative billed total of a purchase, read when settling it. */
export interface PaymentPurchaseTotal {
  purchaseId: UUID;
  /** Current `Purchase.total` as a {@link Money} value (tenant base currency). */
  total: Money;
}

/**
 * Output port the Cash module uses to read a purchase's authoritative **total**
 * when recording a payment (Requirement 9.1).
 *
 * The mirror of {@link import('./payment-sale-reader.js').IPaymentSaleReader}
 * for money going out: recording a purchase payment and deriving its status
 * need the purchase's billed total to compute the outstanding balance. The Cash
 * module declares this port and infrastructure implements it against the
 * `Purchase`/Prisma layer, reading the `total` column, so Cash never imports the
 * Purchases module internals (Dependency Inversion, Clean Architecture
 * Requirement 3.2).
 */
export interface IPaymentPurchaseReader {
  /**
   * Returns the purchase's total, or `null` when no (non-deleted) purchase with
   * `purchaseId` exists for the tenant — the caller turns `null` into a 404.
   */
  getTotal(tenantId: UUID, purchaseId: UUID): Promise<PaymentPurchaseTotal | null>;
}
