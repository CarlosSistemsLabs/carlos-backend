import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/**
 * Filters constraining a top-customers aggregation. The `[from, to]` window is
 * inclusive; `limit` caps how many ranked customers are returned (top-N).
 */
export interface CustomerReportFilters {
  from: Date;
  to: Date;
  limit: number;
}

/** A customer with their aggregated purchasing figures over the window. */
export interface TopCustomerItem {
  customerId: UUID;
  customerName: string;
  salesCount: number;
  totalPurchased: Money;
}

/** The full top-customers aggregation: customers ranked by total purchased. */
export interface CustomerReportData {
  customers: TopCustomerItem[];
}

/**
 * Output port the Reports module uses to rank a tenant's **top customers** by
 * total purchased over the window (Requirement 10.3).
 *
 * Infrastructure implements this against the shared `Sale` table using Prisma
 * `groupBy` on `customerId` (resolving names from `Customer`); the Reports
 * module never imports the Sales/Customers module internals (Dependency
 * Inversion, module boundaries).
 */
export interface ICustomerReportReader {
  topCustomers(tenantId: UUID, filters: CustomerReportFilters): Promise<CustomerReportData>;
}
