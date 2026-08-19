import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/**
 * Filters constraining a product-performance aggregation. The `[from, to]`
 * window is inclusive; `limit` caps how many ranked products are returned.
 */
export interface ProductPerformanceFilters {
  from: Date;
  to: Date;
  limit: number;
}

/** A product with its aggregated sales performance over the window. */
export interface ProductPerformanceItem {
  productId: UUID;
  productName: string;
  sku: string;
  quantitySold: number;
  revenue: Money;
}

/** The full product-performance aggregation: products ranked by quantity sold. */
export interface ProductPerformanceData {
  products: ProductPerformanceItem[];
}

/**
 * Output port the Reports module uses to rank a tenant's **best-selling
 * products** by quantity sold / revenue over the window (Requirement 10.3).
 *
 * Infrastructure implements this against the shared `SaleDetail` table using
 * Prisma `groupBy` on `productId` (resolving names from `Product`); the Reports
 * module never imports the Sales/Products module internals (Dependency
 * Inversion, module boundaries).
 */
export interface IProductPerformanceReader {
  productPerformance(
    tenantId: UUID,
    filters: ProductPerformanceFilters,
  ): Promise<ProductPerformanceData>;
}
