import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/** Authoritative pricing for a product, read at sale time. */
export interface ProductPricing {
  productId: UUID;
  /** Current catalogue unit price as a {@link Money} value. */
  unitPrice: Money;
  /** Current tax rate percentage in `[0, 100]`. */
  taxRate: number;
}

/**
 * Output port the Sales module uses to read **authoritative** product pricing
 * when building a sale (Requirement 9.1).
 *
 * **Pricing-source decision:** rather than trusting a client-supplied unit
 * price on each line, `CreateSale` loads the current price + tax rate from the
 * product catalogue through this port, so totals are computed from the source
 * of truth. The port is *declared in the Sales module* and implemented in
 * infrastructure against the Products/Prisma layer, so Sales does not import
 * Products' internals across the module boundary (Dependency Inversion, Clean
 * Architecture Requirement 3.2). The captured price is then frozen onto the
 * {@link import('../entities/sale-detail.js').SaleDetail} line.
 */
export interface ISaleProductReader {
  /**
   * Returns the current pricing for a tenant's product, or `null` when the
   * product does not exist for that tenant (or is soft-deleted).
   */
  findPricing(tenantId: UUID, productId: UUID): Promise<ProductPricing | null>;
}
