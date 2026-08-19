import { z } from 'zod';

/**
 * Request validation schemas for the report endpoints (task 25.3).
 *
 * These Zod schemas are the source of truth for query validation. The route
 * handlers run them via the shared {@link validateQuery} helper, which raises a
 * domain {@link ValidationError} on failure; the central error handler then maps
 * that onto the consistent error envelope. Validation failures surface as HTTP
 * 400 — the established platform convention (Requirement 25.1).
 *
 * The `tenantId` is intentionally NOT accepted from the client: it is derived
 * from the authenticated JWT (`request.auth`) so a caller can never read across
 * tenant boundaries (Requirement 1.5).
 *
 * Every report accepts a `format` query param selecting the export encoding
 * (`json` — the default, the full structured payload; or `csv` — the row-level
 * tabular section as an RFC 4180 document). The inverted-range check
 * (`from > to`) is NOT expressed here (both bounds are individually valid
 * dates): the use cases reject it with `InvalidDateRangeError`, itself a
 * `ValidationError` → 400.
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the reports plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** Coerced inclusive date bound from an ISO (string) query value. */
const dateBound = z.coerce.date();

/** Export encoding selector; defaults to the structured JSON payload. */
const format = z.enum(['json', 'csv']).default('json');

/** Coerced top-N size from the (string) query value; non-integers → 400. */
const limit = z.coerce.number().int('limit must be an integer');

// ---------------------------------------------------------------------------
// Zod query schemas
// ---------------------------------------------------------------------------

/** Sales-report query string (date window + optional customer/branch filters). */
export const salesReportQuerySchema = z
  .object({
    from: dateBound.optional(),
    to: dateBound.optional(),
    customerId: uuid('customerId').optional(),
    branchId: uuid('branchId').optional(),
    format,
  })
  .strip();

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

/** Stock-report query string (optional branch filter). */
export const stockReportQuerySchema = z
  .object({
    branchId: uuid('branchId').optional(),
    format,
  })
  .strip();

export type StockReportQuery = z.infer<typeof stockReportQuerySchema>;

/** Cash-flow-report query string (date window + optional register filter). */
export const cashFlowReportQuerySchema = z
  .object({
    from: dateBound.optional(),
    to: dateBound.optional(),
    cashId: uuid('cashId').optional(),
    format,
  })
  .strip();

export type CashFlowReportQuery = z.infer<typeof cashFlowReportQuerySchema>;

/** Customer-report query string (date window + top-N limit). */
export const customerReportQuerySchema = z
  .object({
    from: dateBound.optional(),
    to: dateBound.optional(),
    limit: limit.optional(),
    format,
  })
  .strip();

export type CustomerReportQuery = z.infer<typeof customerReportQuerySchema>;

/** Product-performance-report query string (date window + top-N limit). */
export const productReportQuerySchema = z
  .object({
    from: dateBound.optional(),
    to: dateBound.optional(),
    limit: limit.optional(),
    format,
  })
  .strip();

export type ProductReportQuery = z.infer<typeof productReportQuerySchema>;

// ---------------------------------------------------------------------------
// OpenAPI / Swagger documentation schemas (doc-only, not enforced by Fastify)
// ---------------------------------------------------------------------------

const errorEnvelopeSchema = {
  type: 'object',
  properties: {
    error_code: { type: 'string' },
    message: { type: 'string' },
    details: {},
    timestamp: { type: 'string', format: 'date-time' },
    request_id: { type: 'string' },
  },
  required: ['error_code', 'message', 'timestamp', 'request_id'],
} as const;

const formatDoc = {
  type: 'string',
  enum: ['json', 'csv'],
  default: 'json',
  description: 'Export encoding: full structured JSON (default) or a CSV of the tabular rows',
} as const;

const salesReportOutputSchema = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    totals: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        subtotal: { type: 'string' },
        tax: { type: 'string' },
        total: { type: 'string' },
      },
    },
    daily: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          count: { type: 'integer' },
          subtotal: { type: 'string' },
          tax: { type: 'string' },
          total: { type: 'string' },
        },
      },
    },
  },
} as const;

const stockLevelSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string', format: 'uuid' },
    productName: { type: 'string' },
    sku: { type: 'string' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    quantity: { type: 'integer' },
    minStock: { type: 'integer' },
    isLowStock: { type: 'boolean' },
  },
} as const;

const stockReportOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: stockLevelSchema },
    lowStock: { type: 'array', items: stockLevelSchema },
    totalItems: { type: 'integer' },
    lowStockCount: { type: 'integer' },
  },
} as const;

const cashFlowReportOutputSchema = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    income: { type: 'string' },
    expense: { type: 'string' },
    net: { type: 'string' },
    byCategory: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          category: { type: 'string' },
          total: { type: 'string' },
          count: { type: 'integer' },
        },
      },
    },
  },
} as const;

const customerReportOutputSchema = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    customers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          customerId: { type: 'string', format: 'uuid' },
          customerName: { type: 'string' },
          salesCount: { type: 'integer' },
          totalPurchased: { type: 'string' },
        },
      },
    },
  },
} as const;

const productReportOutputSchema = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productId: { type: 'string', format: 'uuid' },
          productName: { type: 'string' },
          sku: { type: 'string' },
          quantitySold: { type: 'integer' },
          revenue: { type: 'string' },
        },
      },
    },
  },
} as const;

const salesQueryDoc = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    customerId: { type: 'string', format: 'uuid' },
    branchId: { type: 'string', format: 'uuid' },
    format: formatDoc,
  },
} as const;

const stockQueryDoc = {
  type: 'object',
  properties: {
    branchId: { type: 'string', format: 'uuid' },
    format: formatDoc,
  },
} as const;

const cashFlowQueryDoc = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    cashId: { type: 'string', format: 'uuid' },
    format: formatDoc,
  },
} as const;

const topNQueryDoc = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    format: formatDoc,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/reports/sales`. */
export const salesReportRouteSchema = {
  tags: ['Reports'],
  summary: 'Sales report (window totals + per-day breakdown; JSON or CSV)',
  querystring: salesQueryDoc,
  response: {
    200: salesReportOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/reports/stock`. */
export const stockReportRouteSchema = {
  tags: ['Reports'],
  summary: 'Stock levels + low-stock alerts (JSON or CSV)',
  querystring: stockQueryDoc,
  response: {
    200: stockReportOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/reports/cash-flow`. */
export const cashFlowReportRouteSchema = {
  tags: ['Reports'],
  summary: 'Cash-flow report (income/expense/net + category buckets; JSON or CSV)',
  querystring: cashFlowQueryDoc,
  response: {
    200: cashFlowReportOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/reports/customers`. */
export const customerReportRouteSchema = {
  tags: ['Reports'],
  summary: 'Customer analysis report (top customers by total purchased; JSON or CSV)',
  querystring: topNQueryDoc,
  response: {
    200: customerReportOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/reports/products`. */
export const productReportRouteSchema = {
  tags: ['Reports'],
  summary: 'Product performance report (best-sellers by quantity/revenue; JSON or CSV)',
  querystring: topNQueryDoc,
  response: {
    200: productReportOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;
