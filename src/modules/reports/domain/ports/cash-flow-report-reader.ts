import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';

/**
 * Filters constraining a cash-flow aggregation. The `[from, to]` window is
 * inclusive and supplied by the use case; `cashId` narrows to a single register.
 */
export interface CashFlowReportFilters {
  from: Date;
  to: Date;
  cashId?: UUID;
}

/** A movement-type + category bucket with its summed amount and count. */
export interface CashFlowCategoryBucket {
  /** `INCOME` or `EXPENSE`. */
  type: string;
  /** Free-text category (`sale`, `purchase`, `opening`, …). */
  category: string;
  total: Money;
  count: number;
}

/**
 * The full cash-flow aggregation: total income, total expense, the net delta
 * (`income - expense`) and the per-type/category breakdown.
 */
export interface CashFlowReportData {
  income: Money;
  expense: Money;
  net: Money;
  byCategory: CashFlowCategoryBucket[];
}

/**
 * Output port the Reports module uses to read aggregated **cash flow** across
 * the reporting window (Requirement 10.3).
 *
 * Infrastructure implements this against the shared `CashMovement` table using
 * Prisma `groupBy` over `type`/`category`; the Reports module never imports the
 * Cash module internals (Dependency Inversion, module boundaries). Money is
 * returned as {@link Money}.
 */
export interface ICashFlowReportReader {
  cashFlow(tenantId: UUID, filters: CashFlowReportFilters): Promise<CashFlowReportData>;
}
