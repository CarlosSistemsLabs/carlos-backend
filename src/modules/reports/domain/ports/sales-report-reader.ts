import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/**
 * Filters constraining a sales-report aggregation. The `[from, to]` window is
 * inclusive and always supplied by the use case (defaulted + validated there);
 * `customerId`/`branchId` narrow the aggregation to a single customer/branch.
 */
export interface SalesReportFilters {
  from: Date;
  to: Date;
  customerId?: UUID;
  branchId?: UUID;
}

/** Aggregate money + count totals for the whole reporting window. */
export interface SalesReportTotals {
  /** Number of (non-deleted, completed) sales in the window. */
  count: number;
  subtotal: Money;
  tax: Money;
  total: Money;
}

/** A single day's rolled-up sales figures (`date` is a `YYYY-MM-DD` day key). */
export interface SalesReportDailyBucket {
  date: string;
  count: number;
  subtotal: Money;
  tax: Money;
  total: Money;
}

/** The full sales-report aggregation: window totals plus a per-day breakdown. */
export interface SalesReportData {
  totals: SalesReportTotals;
  daily: SalesReportDailyBucket[];
}

/**
 * Output port the Reports module uses to read aggregated **sales** figures
 * across the reporting window (Requirement 10.3).
 *
 * The Reports module never imports the Sales module's repositories directly;
 * instead it declares this port and infrastructure implements it against the
 * shared `Sale` table using Prisma aggregation (Dependency Inversion, module
 * boundaries — design "Module Boundaries and Communication"). Money is returned
 * as {@link Money} so the application layer decides the serialisation format.
 */
export interface ISalesReportReader {
  salesSummary(tenantId: UUID, filters: SalesReportFilters): Promise<SalesReportData>;
}
