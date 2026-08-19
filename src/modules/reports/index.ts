/**
 * Public façade for the Reports module.
 *
 * Other modules and the composition root MUST consume reporting capabilities
 * through this barrel rather than reaching into internals (module boundaries,
 * Façade pattern). It exposes the read/aggregation use cases + their DTOs, the
 * reader **output ports**, and the concrete Prisma-backed reader
 * implementations.
 *
 * ## Modelling decisions (task 25.1)
 * - **Reports are read-only aggregations.** The module owns no tables and no
 *   entities. Each report is a thin use case (date-range validation + top-N
 *   clamping + DTO mapping) delegating to a **reader port** that infrastructure
 *   implements against the shared Prisma tables. The Reports module never
 *   imports the Sales/Stock/Cash/Customers/Products module internals
 *   (Dependency Inversion, module boundaries).
 * - **Aggregation lives in the database.** Readers prefer Prisma
 *   `aggregate`/`groupBy` (sales totals, cash-flow by type/category, top
 *   customers by total, product performance by quantity) so the database does
 *   the summing. Two cases need an in-process pass Prisma cannot express without
 *   raw SQL: per-**day** sales bucketing (timestamp truncation) and the
 *   low-stock flag (`quantity <= minStock`, a two-column comparison). Raw-SQL /
 *   composite-index tuning is deferred to task 25.2.
 * - **Money as decimal strings.** Readers return {@link Money}; use cases map to
 *   DTOs exposing money as canonical decimal strings, mirroring the other
 *   modules' output contracts.
 * - **Completed sales only.** Sales/customer/product reports count only
 *   non-deleted, `completed` sales, so drafts and cancellations never skew
 *   figures.
 *
 * ## HTTP endpoints + export (task 25.3)
 * The five reports are exposed as read-only `GET` routes under
 * `/api/v1/reports` ({@link registerReportRoutes}), each gated behind the
 * Business-tier `reports` feature and the `reports:list:read` RBAC permission.
 * Every route supports a `format` query param: `json` (default) returns the
 * full structured payload; `csv` returns the report's row-level tabular section
 * as an RFC 4180 document (dependency-free serialiser in
 * {@link ./presentation/csv.js}) with `Content-Type: text/csv` +
 * `Content-Disposition` download headers.
 */

// Presentation (HTTP routes + CSV/JSON export, task 25.3)
export {
  registerReportRoutes,
  buildReportUseCases,
  reportRoutesPlugin,
  type ReportRoutesOptions,
} from './presentation/report.routes.js';
export {
  escapeCsvField,
  toCsv,
  type CsvValue,
  type CsvRow,
} from './presentation/csv.js';
export {
  salesReportToCsv,
  stockReportToCsv,
  cashFlowReportToCsv,
  customerReportToCsv,
  productPerformanceReportToCsv,
  type CsvExport,
} from './presentation/report-csv.js';

// Use cases (application entry points)
export { SalesReportUseCase } from './application/use-cases/sales-report.use-case.js';
export { StockReportUseCase } from './application/use-cases/stock-report.use-case.js';
export { CashFlowReportUseCase } from './application/use-cases/cash-flow-report.use-case.js';
export { CustomerReportUseCase } from './application/use-cases/customer-report.use-case.js';
export { ProductPerformanceReportUseCase } from './application/use-cases/product-performance-report.use-case.js';

// DTOs, mappers + normalization helpers
export {
  DEFAULT_WINDOW_DAYS,
  DEFAULT_TOP_LIMIT,
  MAX_TOP_LIMIT,
  resolveDateRange,
  normalizeLimit,
  toSalesReportOutput,
  toStockReportOutput,
  toCashFlowReportOutput,
  toCustomerReportOutput,
  toProductPerformanceReportOutput,
  type ResolvedDateRange,
  type SalesReportInputDto,
  type SalesReportOutput,
  type SalesReportTotalsOutput,
  type SalesReportDailyOutput,
  type StockReportInputDto,
  type StockReportOutput,
  type StockLevelOutput,
  type CashFlowReportInputDto,
  type CashFlowReportOutput,
  type CashFlowCategoryOutput,
  type CustomerReportInputDto,
  type CustomerReportOutput,
  type TopCustomerOutput,
  type ProductPerformanceReportInputDto,
  type ProductPerformanceReportOutput,
  type ProductPerformanceOutput,
} from './application/dto/report-dtos.js';

// Errors
export { InvalidDateRangeError } from './domain/errors/report-errors.js';

// Reader ports (implemented by infrastructure against the shared Prisma tables)
export type {
  ISalesReportReader,
  SalesReportFilters,
  SalesReportData,
  SalesReportTotals,
  SalesReportDailyBucket,
} from './domain/ports/sales-report-reader.js';
export type {
  IStockReportReader,
  StockReportFilters,
  StockReportData,
  StockLevelItem,
} from './domain/ports/stock-report-reader.js';
export type {
  ICashFlowReportReader,
  CashFlowReportFilters,
  CashFlowReportData,
  CashFlowCategoryBucket,
} from './domain/ports/cash-flow-report-reader.js';
export type {
  ICustomerReportReader,
  CustomerReportFilters,
  CustomerReportData,
  TopCustomerItem,
} from './domain/ports/customer-report-reader.js';
export type {
  IProductPerformanceReader,
  ProductPerformanceFilters,
  ProductPerformanceData,
  ProductPerformanceItem,
} from './domain/ports/product-performance-reader.js';

// Infrastructure implementations
export {
  PrismaSalesReportReader,
  type SalesReportPrismaClient,
  type SaleReportDelegate,
  type SaleAggregateResult,
  type SaleDailyRow,
} from './infrastructure/prisma-sales-report-reader.js';
export {
  PrismaStockReportReader,
  type StockReportPrismaClient,
  type StockReportDelegate,
  type StockReportRow,
  type StockReportProductRow,
} from './infrastructure/prisma-stock-report-reader.js';
export {
  PrismaCashFlowReportReader,
  type CashFlowReportPrismaClient,
  type CashMovementReportDelegate,
  type CashMovementGroupRow,
} from './infrastructure/prisma-cash-flow-report-reader.js';
export {
  PrismaCustomerReportReader,
  type CustomerReportPrismaClient,
  type SaleCustomerGroupRow,
  type CustomerNameRow,
} from './infrastructure/prisma-customer-report-reader.js';
export {
  PrismaProductPerformanceReader,
  type ProductPerformancePrismaClient,
  type SaleDetailGroupRow,
  type ProductNameRow,
} from './infrastructure/prisma-product-performance-reader.js';
