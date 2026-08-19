import { z } from 'zod';

/**
 * Request validation schemas for the purchase endpoints (task 21.3).
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
 * **Cost is authoritative:** a purchase line carries `productId` + `quantity`
 * and an OPTIONAL `unitCost`. The authoritative catalogue `Product.cost` always
 * takes precedence; the client `unitCost` is only used as a fallback when the
 * catalogue cost is `null` (see the cost-source rule on the purchase product
 * reader / task 21.1). Client input can never override a present catalogue cost,
 * so computed totals cannot be tampered with (Requirement 10.3).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the purchase plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** Creatable statuses — `cancelled` is not a valid creation status. */
const createStatus = z.enum(['draft', 'completed']);

/** Every lifecycle status (used for filtering + status transitions). */
const lifecycleStatus = z.enum(['draft', 'completed', 'cancelled']);

/** Sortable purchase fields, aligned with {@link PurchaseSortField}. */
const sortField = z.enum(['purchaseDate', 'purchaseNumber', 'total', 'createdAt']);
const sortDirection = z.enum(['asc', 'desc']);

const notesField = z.string().trim().min(1);

/**
 * An optional unit-cost override as a positive decimal string (e.g. `"12.50"`)
 * or number. Only consulted when the catalogue `Product.cost` is absent.
 */
const unitCostField = z.union([
  z.string().trim().min(1),
  z.number().positive('unitCost must be positive'),
]);

/** A single requested line: product + positive integer quantity + optional cost. */
const purchaseItemSchema = z
  .object({
    productId: uuid('productId'),
    quantity: z
      .number()
      .int('quantity must be an integer')
      .positive('quantity must be a positive integer'),
    unitCost: unitCostField.optional(),
  })
  .strict();

/**
 * Parses a `sort` query param of the form `field` or `field:direction`
 * (e.g. `purchaseDate`, `total:asc`) into `{ sortBy, sortDirection }`. Defaults
 * the direction to `desc` (most-recent-first) when omitted. Invalid fields or
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
          message: 'sort field must be one of: purchaseDate, purchaseNumber, total, createdAt',
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

/** Create-purchase request body (tenant + user derived from the JWT). */
export const createPurchaseBodySchema = z
  .object({
    supplierId: uuid('supplierId'),
    items: z.array(purchaseItemSchema).min(1, 'a purchase must contain at least one item'),
    notes: notesField.nullish(),
    status: createStatus.optional(),
  })
  .strict();

export type CreatePurchaseBody = z.infer<typeof createPurchaseBodySchema>;

/** Update-purchase-status request body. */
export const updatePurchaseStatusBodySchema = z
  .object({
    status: lifecycleStatus,
  })
  .strict();

export type UpdatePurchaseStatusBody = z.infer<typeof updatePurchaseStatusBodySchema>;

/** Listing query string (page, pageSize, filters, sort). */
export const listPurchasesQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    supplierId: uuid('supplierId').optional(),
    status: lifecycleStatus.optional(),
    from: dateBound.optional(),
    to: dateBound.optional(),
    sort: sortParam.optional(),
  })
  .strip();

export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;

/** `:id` route param. */
export const purchaseIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strip();

export type PurchaseIdParam = z.infer<typeof purchaseIdParamSchema>;

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

const purchaseLineOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    quantity: { type: 'integer' },
    unitCost: { type: 'string' },
    taxRate: { type: 'number' },
    subtotal: { type: 'string' },
    taxAmount: { type: 'string' },
    total: { type: 'string' },
  },
} as const;

const purchaseOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    supplierId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    purchaseNumber: { type: 'string' },
    purchaseDate: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['draft', 'completed', 'cancelled'] },
    currency: { type: 'string' },
    subtotal: { type: 'string' },
    taxAmount: { type: 'string' },
    total: { type: 'string' },
    notes: { type: ['string', 'null'] },
    items: { type: 'array', items: purchaseLineOutputSchema },
  },
} as const;

const pagedPurchaseOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: purchaseOutputSchema },
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

const createPurchaseDocBody = {
  type: 'object',
  required: ['supplierId', 'items'],
  properties: {
    supplierId: { type: 'string', format: 'uuid' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['productId', 'quantity'],
        properties: {
          productId: { type: 'string', format: 'uuid' },
          quantity: { type: 'integer', minimum: 1 },
          unitCost: {
            type: ['string', 'number'],
            description: 'Optional cost fallback used only when the catalogue cost is absent',
          },
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
    supplierId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['draft', 'completed', 'cancelled'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    sort: { type: 'string', description: 'field or field:direction, e.g. "purchaseDate:asc"' },
  },
} as const;

const idParamDoc = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

/** OpenAPI schema for `POST /api/v1/purchases`. */
export const createPurchaseRouteSchema = {
  tags: ['Purchases'],
  summary: 'Create a purchase (authoritative cost, computed totals)',
  body: createPurchaseDocBody,
  response: {
    201: purchaseOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/purchases`. */
export const listPurchasesRouteSchema = {
  tags: ['Purchases'],
  summary: 'List purchases (paginated, filterable by date/supplier/status, sortable)',
  querystring: listQueryDoc,
  response: {
    200: pagedPurchaseOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/purchases/:id`. */
export const getPurchaseRouteSchema = {
  tags: ['Purchases'],
  summary: 'Get a purchase by id, including its line items',
  params: idParamDoc,
  response: {
    200: purchaseOutputSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/purchases/:id/status`. */
export const updatePurchaseStatusRouteSchema = {
  tags: ['Purchases'],
  summary: 'Update a purchase status (draft, completed, cancelled)',
  params: idParamDoc,
  body: updateStatusDocBody,
  response: {
    200: purchaseOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `DELETE /api/v1/purchases/:id`. */
export const deletePurchaseRouteSchema = {
  tags: ['Purchases'],
  summary: 'Soft-delete a purchase',
  params: idParamDoc,
  response: {
    204: { type: 'null', description: 'Purchase deleted' },
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;
