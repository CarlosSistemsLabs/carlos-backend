import { z } from 'zod';

/**
 * Request validation schemas for the sale endpoints (task 19.3).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateQuery}/
 * {@link validateParams} helpers, which raise a domain {@link ValidationError}
 * on failure; the central error handler then maps that onto the consistent
 * error envelope with field-level messages (Requirements 25.5, 25.7). Validation
 * failures surface as HTTP 400 — the established platform convention, which
 * Requirement 25.6 permits alongside 422.
 *
 * The `tenantId` and `userId` are intentionally NOT accepted from the client:
 * they are derived from the authenticated JWT (`request.auth`) so a caller can
 * never act across tenant boundaries or spoof authorship (Requirement 1.5).
 *
 * **Pricing is authoritative:** a sale line carries only `productId` +
 * `quantity`; unit prices/tax rates are resolved from the catalogue by the use
 * case, so client input can never tamper with the computed totals
 * (Requirement 9.1).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the sale plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** Creatable statuses — `cancelled` is not a valid creation status. */
const createStatus = z.enum(['draft', 'completed']);

/** Every lifecycle status (used for filtering + status transitions). */
const lifecycleStatus = z.enum(['draft', 'completed', 'cancelled']);

/** Sortable sale fields, aligned with {@link SaleSortField}. */
const sortField = z.enum(['saleDate', 'saleNumber', 'total', 'createdAt']);
const sortDirection = z.enum(['asc', 'desc']);

const notesField = z.string().trim().min(1);

/** A single requested line: product + positive integer quantity. */
const saleItemSchema = z
  .object({
    productId: uuid('productId'),
    quantity: z
      .number()
      .int('quantity must be an integer')
      .positive('quantity must be a positive integer'),
  })
  .strict();

/**
 * Parses a `sort` query param of the form `field` or `field:direction`
 * (e.g. `saleDate`, `total:asc`) into `{ sortBy, sortDirection }`. Defaults the
 * direction to `desc` (most-recent-first) when omitted. Invalid fields or
 * directions fail validation.
 */
const sortParam = z
  .string()
  .trim()
  .transform(
    (
      value,
      ctx,
    ): { sortBy: z.infer<typeof sortField>; sortDirection: z.infer<typeof sortDirection> } => {
      const [rawField, rawDirection] = value.split(':');
      const fieldResult = sortField.safeParse(rawField);
      if (!fieldResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sort field must be one of: saleDate, saleNumber, total, createdAt',
        });
        return z.NEVER;
      }
      const direction = rawDirection ?? 'desc';
      const directionResult = sortDirection.safeParse(direction);
      if (!directionResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sort direction must be "asc" or "desc"',
        });
        return z.NEVER;
      }
      return { sortBy: fieldResult.data, sortDirection: directionResult.data };
    },
  );

/** Coerced positive page number from the (string) query value. */
const page = z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1');

/** Coerced page size from the (string) query value. */
const pageSize = z.coerce
  .number()
  .int('pageSize must be an integer')
  .min(1, 'pageSize must be >= 1');

/** Coerced inclusive date bound from an ISO (string) query value. */
const dateBound = z.coerce.date();

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** Create-sale request body (tenant + user derived from the JWT). */
export const createSaleBodySchema = z
  .object({
    customerId: uuid('customerId'),
    branchId: uuid('branchId').nullish(),
    items: z.array(saleItemSchema).min(1, 'a sale must contain at least one item'),
    notes: notesField.nullish(),
    status: createStatus.optional(),
  })
  .strict();

export type CreateSaleBody = z.infer<typeof createSaleBodySchema>;

/** Update-sale-status request body. */
export const updateSaleStatusBodySchema = z
  .object({
    status: lifecycleStatus,
  })
  .strict();

export type UpdateSaleStatusBody = z.infer<typeof updateSaleStatusBodySchema>;

/** Listing query string (page, pageSize, filters, sort). */
export const listSalesQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    customerId: uuid('customerId').optional(),
    branchId: uuid('branchId').optional(),
    status: lifecycleStatus.optional(),
    from: dateBound.optional(),
    to: dateBound.optional(),
    sort: sortParam.optional(),
  })
  .strip();

export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

/** `:id` route param. */
export const saleIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strip();

export type SaleIdParam = z.infer<typeof saleIdParamSchema>;

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

const saleLineOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    quantity: { type: 'integer' },
    unitPrice: { type: 'string' },
    taxRate: { type: 'number' },
    subtotal: { type: 'string' },
    taxAmount: { type: 'string' },
    total: { type: 'string' },
  },
} as const;

const saleOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    customerId: { type: 'string', format: 'uuid' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    saleNumber: { type: 'string' },
    saleDate: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['draft', 'completed', 'cancelled'] },
    currency: { type: 'string' },
    subtotal: { type: 'string' },
    taxAmount: { type: 'string' },
    total: { type: 'string' },
    notes: { type: ['string', 'null'] },
    items: { type: 'array', items: saleLineOutputSchema },
  },
} as const;

const pagedSaleOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: saleOutputSchema },
    meta: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        totalPages: { type: 'integer' },
      },
      required: ['total', 'page', 'pageSize', 'totalPages'],
    },
  },
  required: ['items', 'meta'],
} as const;

const createSaleDocBody = {
  type: 'object',
  required: ['customerId', 'items'],
  properties: {
    customerId: { type: 'string', format: 'uuid' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['productId', 'quantity'],
        properties: {
          productId: { type: 'string', format: 'uuid' },
          quantity: { type: 'integer', minimum: 1 },
        },
      },
    },
    notes: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['draft', 'completed'] },
  },
} as const;

const updateStatusDocBody = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['draft', 'completed', 'cancelled'] },
  },
} as const;

const listQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    customerId: { type: 'string', format: 'uuid' },
    branchId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['draft', 'completed', 'cancelled'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    sort: { type: 'string', description: 'field or field:direction, e.g. "saleDate:asc"' },
  },
} as const;

const idParamDoc = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

/** OpenAPI schema for `POST /api/v1/sales`. */
export const createSaleRouteSchema = {
  tags: ['Sales'],
  summary: 'Create a sale (authoritative pricing, computed totals)',
  body: createSaleDocBody,
  response: {
    201: saleOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/sales`. */
export const listSalesRouteSchema = {
  tags: ['Sales'],
  summary: 'List sales (paginated, filterable by date/customer/status, sortable)',
  querystring: listQueryDoc,
  response: {
    200: pagedSaleOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/sales/:id`. */
export const getSaleRouteSchema = {
  tags: ['Sales'],
  summary: 'Get a sale by id, including its line items',
  params: idParamDoc,
  response: {
    200: saleOutputSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/sales/:id/status`. */
export const updateSaleStatusRouteSchema = {
  tags: ['Sales'],
  summary: 'Update a sale status (draft, completed, cancelled)',
  params: idParamDoc,
  body: updateStatusDocBody,
  response: {
    200: saleOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `DELETE /api/v1/sales/:id`. */
export const deleteSaleRouteSchema = {
  tags: ['Sales'],
  summary: 'Soft-delete a sale',
  params: idParamDoc,
  response: {
    204: { type: 'null', description: 'Sale deleted' },
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;
