import { z } from 'zod';

/**
 * Request validation schemas for the stock endpoints (task 15.3).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateQuery}
 * helpers, which raise a domain {@link ValidationError} on failure; the central
 * error handler then maps that onto the consistent error envelope with
 * field-level messages (Requirements 25.5, 25.7). Validation failures surface
 * as HTTP 400 — the established platform convention.
 *
 * The `tenantId` is intentionally NOT accepted from the client: it is derived
 * from the authenticated JWT (`request.auth.tenantId`) so a caller can never
 * act across tenant boundaries (Requirement 1.5).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the stock plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** Coerced positive page number from the (string) query value. */
const page = z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1');

/** Coerced page size from the (string) query value. */
const pageSize = z.coerce
  .number()
  .int('pageSize must be an integer')
  .min(1, 'pageSize must be >= 1');

/** The four recognised stock-movement types. */
const movementType = z.enum(['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER']);

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** `GET /api/v1/stock` query string (page, pageSize, product/branch filters). */
export const listStockLevelsQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    productId: uuid('productId').optional(),
    branchId: uuid('branchId').optional(),
  })
  .strip();

export type ListStockLevelsQuery = z.infer<typeof listStockLevelsQuerySchema>;

/** `GET /api/v1/stock/alerts` query string (page, pageSize, branch filter). */
export const listStockAlertsQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    branchId: uuid('branchId').optional(),
  })
  .strip();

export type ListStockAlertsQuery = z.infer<typeof listStockAlertsQuerySchema>;

/** `GET /api/v1/stock/movements` query string (filters + pagination). */
export const listStockMovementsQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    productId: uuid('productId').optional(),
    branchId: uuid('branchId').optional(),
    type: movementType.optional(),
    from: z.coerce.date({ invalid_type_error: 'from must be a valid date' }).optional(),
    to: z.coerce.date({ invalid_type_error: 'to must be a valid date' }).optional(),
  })
  .strip();

export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;

/** Coerced cursor-page size (`limit`) from the (string) query value. */
const limit = z.coerce.number().int('limit must be an integer').min(1, 'limit must be >= 1');

/**
 * `GET /api/v1/stock/movements/cursor` query string — the cursor-paginated
 * variant of the movement history for large datasets (Requirement 26.6). Uses
 * an opaque `cursor` + `limit` instead of `page`/`pageSize`; the same filters
 * apply. The `cursor` is treated as opaque and never parsed client-side.
 */
export const listStockMovementsByCursorQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: limit.optional(),
    productId: uuid('productId').optional(),
    branchId: uuid('branchId').optional(),
    type: movementType.optional(),
    from: z.coerce.date({ invalid_type_error: 'from must be a valid date' }).optional(),
    to: z.coerce.date({ invalid_type_error: 'to must be a valid date' }).optional(),
  })
  .strip();

export type ListStockMovementsByCursorQuery = z.infer<
  typeof listStockMovementsByCursorQuerySchema
>;

/**
 * `POST /api/v1/stock/adjust` request body (tenant derived from the JWT).
 *
 * `quantity` must be a positive integer. A `TRANSFER` moves units between two
 * branches and therefore requires a `destinationBranchId` distinct from the
 * source `branchId`; the refinement below enforces that at the edge so a
 * malformed transfer fails validation (400) rather than reaching the domain.
 */
export const adjustStockBodySchema = z
  .object({
    productId: uuid('productId'),
    branchId: uuid('branchId').nullish(),
    type: movementType,
    quantity: z.number().int('quantity must be an integer').positive('quantity must be > 0'),
    destinationBranchId: uuid('destinationBranchId').nullish(),
    reference: z.string().trim().min(1).nullish(),
    notes: z.string().trim().min(1).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'TRANSFER') {
      if (value.destinationBranchId === undefined || value.destinationBranchId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationBranchId'],
          message: 'destinationBranchId is required for a TRANSFER',
        });
        return;
      }
      const source = value.branchId ?? null;
      if (value.destinationBranchId === source) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationBranchId'],
          message: 'destinationBranchId must differ from the source branchId',
        });
      }
    }
  });

export type AdjustStockBody = z.infer<typeof adjustStockBodySchema>;

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

const stockLevelOutputSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string', format: 'uuid' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    quantity: { type: 'integer' },
    productName: { type: 'string' },
    minStock: { type: 'integer' },
    lowStock: { type: 'boolean' },
  },
} as const;

const pagedStockLevelOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: stockLevelOutputSchema },
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

const stockMovementOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    type: { type: 'string', enum: ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'] },
    quantity: { type: 'integer' },
    reference: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const pagedStockMovementOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: stockMovementOutputSchema },
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

const cursorPagedStockMovementOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: stockMovementOutputSchema },
    nextCursor: {
      type: ['string', 'null'],
      description: 'Opaque cursor for the next page, or null on the last page',
    },
    hasMore: { type: 'boolean' },
  },
  required: ['items', 'nextCursor', 'hasMore'],
} as const;

const adjustStockOutputSchema = {
  type: 'object',
  properties: {
    stocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string', format: 'uuid' },
          productId: { type: 'string', format: 'uuid' },
          branchId: { type: ['string', 'null'], format: 'uuid' },
          quantity: { type: 'integer' },
        },
      },
    },
    movements: { type: 'array', items: stockMovementOutputSchema },
  },
  required: ['stocks', 'movements'],
} as const;

const listLevelsQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    productId: { type: 'string', format: 'uuid' },
    branchId: { type: 'string', format: 'uuid' },
  },
} as const;

const listAlertsQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    branchId: { type: 'string', format: 'uuid' },
  },
} as const;

const listMovementsQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    productId: { type: 'string', format: 'uuid' },
    branchId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
} as const;

const listMovementsCursorQueryDoc = {
  type: 'object',
  properties: {
    cursor: { type: 'string', description: 'Opaque cursor from a previous page' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    productId: { type: 'string', format: 'uuid' },
    branchId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
} as const;

const adjustStockDocBody = {
  type: 'object',
  required: ['productId', 'type', 'quantity'],
  properties: {
    productId: { type: 'string', format: 'uuid' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    type: { type: 'string', enum: ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'] },
    quantity: { type: 'integer', minimum: 1 },
    destinationBranchId: {
      type: ['string', 'null'],
      format: 'uuid',
      description: 'Required for a TRANSFER; must differ from branchId',
    },
    reference: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
} as const;

/** OpenAPI schema for `GET /api/v1/stock`. */
export const listStockLevelsRouteSchema = {
  tags: ['Stock'],
  summary: 'List stock levels by product/branch (paginated, low-stock flagged)',
  querystring: listLevelsQueryDoc,
  response: {
    200: pagedStockLevelOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/stock/alerts`. */
export const listStockAlertsRouteSchema = {
  tags: ['Stock'],
  summary: 'List low-stock alerts (balances at or below their minStock)',
  querystring: listAlertsQueryDoc,
  response: {
    200: pagedStockLevelOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/stock/movements`. */
export const listStockMovementsRouteSchema = {
  tags: ['Stock'],
  summary: 'Get stock movement history (paginated, filterable)',
  querystring: listMovementsQueryDoc,
  response: {
    200: pagedStockMovementOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/stock/movements/cursor`. */
export const listStockMovementsByCursorRouteSchema = {
  tags: ['Stock'],
  summary: 'Get stock movement history with cursor pagination (large datasets)',
  querystring: listMovementsCursorQueryDoc,
  response: {
    200: cursorPagedStockMovementOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/stock/adjust`. */
export const adjustStockRouteSchema = {
  tags: ['Stock'],
  summary: 'Adjust stock levels (IN/OUT/ADJUSTMENT/TRANSFER) and record the movement',
  body: adjustStockDocBody,
  response: {
    200: adjustStockOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;
