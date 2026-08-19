import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { REPORT_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateQuery } from '@presentation/validators/index.js';
import type { SalesReportUseCase } from '../application/use-cases/sales-report.use-case.js';
import type { StockReportUseCase } from '../application/use-cases/stock-report.use-case.js';
import type { CashFlowReportUseCase } from '../application/use-cases/cash-flow-report.use-case.js';
import type { CustomerReportUseCase } from '../application/use-cases/customer-report.use-case.js';
import type { ProductPerformanceReportUseCase } from '../application/use-cases/product-performance-report.use-case.js';
import type {
  SalesReportInputDto,
  StockReportInputDto,
  CashFlowReportInputDto,
  CustomerReportInputDto,
  ProductPerformanceReportInputDto,
} from '../application/dto/report-dtos.js';
import {
  salesReportQuerySchema,
  stockReportQuerySchema,
  cashFlowReportQuerySchema,
  customerReportQuerySchema,
  productReportQuerySchema,
  salesReportRouteSchema,
  stockReportRouteSchema,
  cashFlowReportRouteSchema,
  customerReportRouteSchema,
  productReportRouteSchema,
} from './report.schemas.js';
import {
  salesReportToCsv,
  stockReportToCsv,
  cashFlowReportToCsv,
  customerReportToCsv,
  productPerformanceReportToCsv,
  type CsvExport,
} from './report-csv.js';

/**
 * The feature key gating the Reports module.
 *
 * Reporting is a Business-tier feature: the canonical plan → feature matrix
 * (`PLAN_FEATURE_MATRIX`) grants `reports` from the Business tier upward, so a
 * tenant on Starter (or with no active subscription) is refused with a 403 by
 * the subscription/feature guard (Requirement 10.3).
 */
const REPORTS_FEATURE = FEATURES.REPORTS;

/** Bundle of the five report use cases wired from the DI container. */
interface ReportUseCases {
  sales: SalesReportUseCase;
  stock: StockReportUseCase;
  cashFlow: CashFlowReportUseCase;
  customers: CustomerReportUseCase;
  products: ProductPerformanceReportUseCase;
}

/** Resolves the report use cases from the composition container. */
export function buildReportUseCases(container: Container): ReportUseCases {
  return {
    sales: container.resolve(REPORT_TOKENS.SalesReportUseCase),
    stock: container.resolve(REPORT_TOKENS.StockReportUseCase),
    cashFlow: container.resolve(REPORT_TOKENS.CashFlowReportUseCase),
    customers: container.resolve(REPORT_TOKENS.CustomerReportUseCase),
    products: container.resolve(REPORT_TOKENS.ProductPerformanceReportUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request.
 *
 * Defence in depth: every report route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than aggregating without a tenant scope (Requirement 1.5).
 * Reports are read-only and always scoped to the caller's tenant — the tenant
 * id comes from the token, never from the client query.
 */
function requireTenantId(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return auth.tenantId;
}

/**
 * Sends a report either as its full structured JSON payload (`format=json`, the
 * default) or as an RFC 4180 CSV of the report's tabular rows (`format=csv`),
 * with the download headers (`Content-Type: text/csv` + `Content-Disposition`)
 * set for the CSV case.
 */
function sendReport<T>(
  reply: FastifyReply,
  format: 'json' | 'csv',
  report: T,
  toCsvExport: (report: T) => CsvExport,
): FastifyReply {
  if (format === 'csv') {
    const { filename, content } = toCsvExport(report);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .status(200)
      .send(content);
  }
  return reply.status(200).send(report);
}

/** Options accepted by the {@link reportRoutesPlugin}. */
export interface ReportRoutesOptions {
  /** Composition container with the report infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the read-only report endpoints under
 * `/api/v1/reports`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.requireFeature` enforces the subscription/feature
 * guard (403 when the tenant's plan does not grant `reports`) and
 * `app.authorize('reports', 'list', 'read')` enforces RBAC (403 when the role
 * lacks the read permission). Query strings are validated with Zod via the
 * shared validators; validation failures (bad UUID, non-integer limit, …) map
 * to the consistent 400 envelope, and an inverted date range surfaces as 400
 * too (the use cases' `InvalidDateRangeError` is a `ValidationError`). The
 * attached `schema` objects document the routes for OpenAPI (Requirement 3.7);
 * Fastify's own validation is disabled inside this encapsulated plugin so it
 * never short-circuits the Zod checks. Mirrors the Cash/Purchases module wiring.
 */
export const reportRoutesPlugin: FastifyPluginAsync<ReportRoutesOptions> = (app, opts) => {
  const useCases = buildReportUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  const readGuards = [
    app.authenticate,
    app.requireFeature(REPORTS_FEATURE),
    app.authorize('reports', 'list', 'read'),
  ];

  // GET /api/v1/reports/sales — sales report (window totals + per-day breakdown)
  app.get(
    '/sales',
    { schema: salesReportRouteSchema, preHandler: readGuards },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, salesReportQuerySchema);
      const input: SalesReportInputDto = {
        tenantId,
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      };
      const report = await useCases.sales.execute(input);
      return sendReport(reply, query.format, report, (r) => salesReportToCsv(r));
    },
  );

  // GET /api/v1/reports/stock — current stock levels + low-stock alerts
  app.get(
    '/stock',
    { schema: stockReportRouteSchema, preHandler: readGuards },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, stockReportQuerySchema);
      const input: StockReportInputDto = {
        tenantId,
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      };
      const report = await useCases.stock.execute(input);
      return sendReport(reply, query.format, report, (r) => stockReportToCsv(r));
    },
  );

  // GET /api/v1/reports/cash-flow — income/expense/net + category buckets
  app.get(
    '/cash-flow',
    { schema: cashFlowReportRouteSchema, preHandler: readGuards },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, cashFlowReportQuerySchema);
      const input: CashFlowReportInputDto = {
        tenantId,
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        ...(query.cashId !== undefined ? { cashId: query.cashId } : {}),
      };
      const report = await useCases.cashFlow.execute(input);
      return sendReport(reply, query.format, report, (r) => cashFlowReportToCsv(r));
    },
  );

  // GET /api/v1/reports/customers — top customers by total purchased
  app.get(
    '/customers',
    { schema: customerReportRouteSchema, preHandler: readGuards },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, customerReportQuerySchema);
      const input: CustomerReportInputDto = {
        tenantId,
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      };
      const report = await useCases.customers.execute(input);
      return sendReport(reply, query.format, report, (r) => customerReportToCsv(r));
    },
  );

  // GET /api/v1/reports/products — best-selling products by quantity/revenue
  app.get(
    '/products',
    { schema: productReportRouteSchema, preHandler: readGuards },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, productReportQuerySchema);
      const input: ProductPerformanceReportInputDto = {
        tenantId,
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      };
      const report = await useCases.products.execute(input);
      return sendReport(reply, query.format, report, (r) => productPerformanceReportToCsv(r));
    },
  );

  return Promise.resolve();
};

/**
 * Registers the report routes under the `/api/v1/reports` prefix.
 *
 * Wraps {@link reportRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerReportRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(reportRoutesPlugin, { prefix: '/api/v1/reports', container });
}
