import type { Nullable, UUID } from '@shared/types/index.js';

/** Filters constraining a stock-levels aggregation. */
export interface StockReportFilters {
  /** Restrict to a single branch's stock rows; omit for all branches. */
  branchId?: UUID;
}

/**
 * A product's stock level at a location, joined with the product's reorder
 * threshold so the caller can flag low stock.
 */
export interface StockLevelItem {
  productId: UUID;
  productName: string;
  sku: string;
  branchId: Nullable<UUID>;
  quantity: number;
  minStock: number;
  /** `true` when `quantity <= minStock` (at or below the reorder threshold). */
  isLowStock: boolean;
}

/**
 * The full stock-report aggregation: every stock level plus the low-stock
 * subset and summary counts.
 */
export interface StockReportData {
  items: StockLevelItem[];
  lowStock: StockLevelItem[];
  totalItems: number;
  lowStockCount: number;
}

/**
 * Output port the Reports module uses to read current **stock levels** and
 * low-stock alerts (Requirement 10.3).
 *
 * Infrastructure implements this against the shared `Stock` table joined to
 * `Product` (for `name`/`sku`/`minStock`); the Reports module never imports the
 * Stock module internals (Dependency Inversion, module boundaries).
 */
export interface IStockReportReader {
  stockLevels(tenantId: UUID, filters: StockReportFilters): Promise<StockReportData>;
}
