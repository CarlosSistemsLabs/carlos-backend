import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/** Authoritative cost information for a product, read at purchase time. */
export interface ProductCost {
  productId: UUID;
  /**
   * Current catalogue unit **cost** as a {@link Money} value, or `null` when the
   * product has no recorded cost (`Product.cost` is nullable in the schema).
   */
  unitCost: Money | null;
  /** Current tax rate percentage in `[0, 100]`. */
  taxRate: number;
}

/**
 * Output port the Purchases module uses to read **authoritative** product cost
 * when building a purchase (Requirement 9.1, 10.3).
 *
 * **Cost-source decision:** for purchases the relevant price is the **cost**
 * (`Product.cost`), i.e. what the tenant pays the supplier — never the sale
 * price. `CreatePurchase` loads the current cost + tax rate from the product
 * catalogue through this port so totals derive from the source of truth. The
 * port is *declared in the Purchases module* and implemented in infrastructure
 * against the Products/Prisma layer, so Purchases does not import Products'
 * internals across the module boundary (Dependency Inversion, Clean
 * Architecture Requirement 3.2).
 *
 * **Nullable-cost handling:** `Product.cost` is nullable. When the catalogue
 * cost is `null`, the use case falls back to a client-supplied `unitCost` on the
 * line; if neither is present it rejects the line with a
 * {@link import('../errors/purchase-errors.js').MissingProductCostError}. This
 * lets a tenant record a purchase at a negotiated cost that differs from (or is
 * absent in) the catalogue while still preferring the authoritative value.
 */
export interface IPurchaseProductReader {
  /**
   * Returns the current cost for a tenant's product, or `null` when the product
   * does not exist for that tenant (or is soft-deleted). Note the difference
   * between a missing product (`null` result) and a product with no cost
   * (`ProductCost` with `unitCost: null`).
   */
  findCost(tenantId: UUID, productId: UUID): Promise<ProductCost | null>;
}
