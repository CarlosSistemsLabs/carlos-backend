import type { Nullable, UUID } from '@shared/types/index.js';
import { InvalidDateRangeError } from '../../domain/errors/report-errors.js';
import type {
  SalesReportData,
  SalesReportDailyBucket,
  SalesReportTotals,
} from '../../domain/ports/sales-report-reader.js';
import type { StockLevelItem, StockReportData } from '../../domain/ports/stock-report-reader.js';
import type {
  CashFlowCategoryBucket,
  CashFlowReportData,
} from '../../domain/ports/cash-flow-report-reader.js';
import type { CustomerReportData, TopCustomerItem } from '../../domain/ports/customer-report-reader.js';
import type {
  ProductPerformanceData,
  ProductPerformanceItem,
} from '../../domain/ports/product-performance-reader.js';

/**
 * Default reporting window length (days) applied when a caller omits `from`.
 *
 * Reports are unbounded by nature, so an absent window is defaulted rather than
 * rejected: the last {@link DEFAULT_WINDOW_DAYS} days ending at `to` (or now).
 */
export const DEFAULT_WINDOW_DAYS = 30;

/** Default top-N size when a caller omits `limit`. */
export const DEFAULT_TOP_LIMIT = 10;

/** Upper bound on top-N size, mirroring the platform pagination ceiling. */
export const MAX_TOP_LIMIT = 100;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A validated, fully-resolved inclusive reporting window. */
export interface ResolvedDateRange {
  from: Date;
  to: Date;
}

/**
 * Resolves and validates a `[from, to]` reporting window.
 *
 * Defaults an absent `to` to now and an absent `from` to {@link
 * DEFAULT_WINDOW_DAYS} days before `to`, then rejects an inverted range
 * (`from > to`) with {@link InvalidDateRangeError}. Centralising this keeps
 * every report use case consistent and guarantees a reader only ever sees a
 * sane window.
 */
export function resolveDateRange(from?: Date, to?: Date): ResolvedDateRange {
  const resolvedTo = to ?? new Date();
  const resolvedFrom = from ?? new Date(resolvedTo.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);
  if (resolvedFrom.getTime() > resolvedTo.getTime()) {
    throw new InvalidDateRangeError(resolvedFrom, resolvedTo);
  }
  return { from: resolvedFrom, to: resolvedTo };
}

/**
 * Clamps a requested top-N `limit` into `[1, {@link MAX_TOP_LIMIT}]`, defaulting
 * to {@link DEFAULT_TOP_LIMIT} when absent. Non-integers are floored. This stops
 * a hostile or buggy client from requesting an unbounded ranking.
 */
export function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_TOP_LIMIT;
  }
  const floored = Math.floor(limit);
  if (floored < 1) {
    return 1;
  }
  if (floored > MAX_TOP_LIMIT) {
    return MAX_TOP_LIMIT;
  }
  return floored;
}

// ---------------------------------------------------------------------------
// Sales report
// ---------------------------------------------------------------------------

/** Input for the sales report use case. */
export interface SalesReportInputDto {
  tenantId: UUID;
  from?: Date;
  to?: Date;
  customerId?: UUID;
  branchId?: UUID;
}

/** Money-as-decimal-string projection of the window totals. */
export interface SalesReportTotalsOutput {
  count: number;
  subtotal: string;
  tax: string;
  total: string;
}

/** Money-as-decimal-string projection of a single day's figures. */
export interface SalesReportDailyOutput {
  date: string;
  count: number;
  subtotal: string;
  tax: string;
  total: string;
}

/** Public projection of a sales report. */
export interface SalesReportOutput {
  from: string;
  to: string;
  totals: SalesReportTotalsOutput;
  daily: SalesReportDailyOutput[];
}

function toSalesTotalsOutput(totals: SalesReportTotals): SalesReportTotalsOutput {
  return {
    count: totals.count,
    subtotal: totals.subtotal.toDecimalString(),
    tax: totals.tax.toDecimalString(),
    total: totals.total.toDecimalString(),
  };
}

function toSalesDailyOutput(bucket: SalesReportDailyBucket): SalesReportDailyOutput {
  return {
    date: bucket.date,
    count: bucket.count,
    subtotal: bucket.subtotal.toDecimalString(),
    tax: bucket.tax.toDecimalString(),
    total: bucket.total.toDecimalString(),
  };
}

/** Maps the sales-report aggregation to its public projection. */
export function toSalesReportOutput(range: ResolvedDateRange, data: SalesReportData): SalesReportOutput {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    totals: toSalesTotalsOutput(data.totals),
    daily: data.daily.map(toSalesDailyOutput),
  };
}

// ---------------------------------------------------------------------------
// Stock report
// ---------------------------------------------------------------------------

/** Input for the stock report use case. */
export interface StockReportInputDto {
  tenantId: UUID;
  branchId?: UUID;
}

/** Public projection of a single stock level. */
export interface StockLevelOutput {
  productId: UUID;
  productName: string;
  sku: string;
  branchId: Nullable<UUID>;
  quantity: number;
  minStock: number;
  isLowStock: boolean;
}

/** Public projection of a stock report. */
export interface StockReportOutput {
  items: StockLevelOutput[];
  lowStock: StockLevelOutput[];
  totalItems: number;
  lowStockCount: number;
}

function toStockLevelOutput(item: StockLevelItem): StockLevelOutput {
  return {
    productId: item.productId,
    productName: item.productName,
    sku: item.sku,
    branchId: item.branchId,
    quantity: item.quantity,
    minStock: item.minStock,
    isLowStock: item.isLowStock,
  };
}

/** Maps the stock-report aggregation to its public projection. */
export function toStockReportOutput(data: StockReportData): StockReportOutput {
  return {
    items: data.items.map(toStockLevelOutput),
    lowStock: data.lowStock.map(toStockLevelOutput),
    totalItems: data.totalItems,
    lowStockCount: data.lowStockCount,
  };
}

// ---------------------------------------------------------------------------
// Cash-flow report
// ---------------------------------------------------------------------------

/** Input for the cash-flow report use case. */
export interface CashFlowReportInputDto {
  tenantId: UUID;
  from?: Date;
  to?: Date;
  cashId?: UUID;
}

/** Public projection of a type/category cash-flow bucket. */
export interface CashFlowCategoryOutput {
  type: string;
  category: string;
  total: string;
  count: number;
}

/** Public projection of a cash-flow report. */
export interface CashFlowReportOutput {
  from: string;
  to: string;
  income: string;
  expense: string;
  net: string;
  byCategory: CashFlowCategoryOutput[];
}

function toCashFlowCategoryOutput(bucket: CashFlowCategoryBucket): CashFlowCategoryOutput {
  return {
    type: bucket.type,
    category: bucket.category,
    total: bucket.total.toDecimalString(),
    count: bucket.count,
  };
}

/** Maps the cash-flow aggregation to its public projection. */
export function toCashFlowReportOutput(
  range: ResolvedDateRange,
  data: CashFlowReportData,
): CashFlowReportOutput {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    income: data.income.toDecimalString(),
    expense: data.expense.toDecimalString(),
    net: data.net.toDecimalString(),
    byCategory: data.byCategory.map(toCashFlowCategoryOutput),
  };
}

// ---------------------------------------------------------------------------
// Customer report
// ---------------------------------------------------------------------------

/** Input for the customer (top-customers) report use case. */
export interface CustomerReportInputDto {
  tenantId: UUID;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Public projection of a ranked customer. */
export interface TopCustomerOutput {
  customerId: UUID;
  customerName: string;
  salesCount: number;
  totalPurchased: string;
}

/** Public projection of a customer report. */
export interface CustomerReportOutput {
  from: string;
  to: string;
  customers: TopCustomerOutput[];
}

function toTopCustomerOutput(item: TopCustomerItem): TopCustomerOutput {
  return {
    customerId: item.customerId,
    customerName: item.customerName,
    salesCount: item.salesCount,
    totalPurchased: item.totalPurchased.toDecimalString(),
  };
}

/** Maps the customer aggregation to its public projection. */
export function toCustomerReportOutput(
  range: ResolvedDateRange,
  data: CustomerReportData,
): CustomerReportOutput {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    customers: data.customers.map(toTopCustomerOutput),
  };
}

// ---------------------------------------------------------------------------
// Product-performance report
// ---------------------------------------------------------------------------

/** Input for the product-performance report use case. */
export interface ProductPerformanceReportInputDto {
  tenantId: UUID;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Public projection of a ranked product. */
export interface ProductPerformanceOutput {
  productId: UUID;
  productName: string;
  sku: string;
  quantitySold: number;
  revenue: string;
}

/** Public projection of a product-performance report. */
export interface ProductPerformanceReportOutput {
  from: string;
  to: string;
  products: ProductPerformanceOutput[];
}

function toProductPerformanceOutput(item: ProductPerformanceItem): ProductPerformanceOutput {
  return {
    productId: item.productId,
    productName: item.productName,
    sku: item.sku,
    quantitySold: item.quantitySold,
    revenue: item.revenue.toDecimalString(),
  };
}

/** Maps the product-performance aggregation to its public projection. */
export function toProductPerformanceReportOutput(
  range: ResolvedDateRange,
  data: ProductPerformanceData,
): ProductPerformanceReportOutput {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    products: data.products.map(toProductPerformanceOutput),
  };
}
