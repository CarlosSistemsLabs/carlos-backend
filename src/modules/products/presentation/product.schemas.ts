import { z } from 'zod';

/**
 * Request validation schemas for the product endpoints (task 13.3).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateQuery}/
 * {@link validateParams} helpers, which raise a domain {@link ValidationError}
 * on failure; the central error handler then maps that onto the consistent
 * error envelope with field-level messages (Requirements 25.5, 25.7). Validation
 * failures surface as HTTP 400 — the established platform convention, which
 * Requirement 25.6 permits alongside 422.
 *
 * The `tenantId` is intentionally NOT accepted from the client: it is derived
 * from the authenticated JWT (`request.auth.tenantId`) so a caller can never
 * act across tenant boundaries (Requirement 1.5).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the product plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** Decimal-string money amount, e.g. `"19.90"` (the {@link Money} input form). */
const decimalString = (field: string): z.ZodString =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, `${field} must be a decimal string (e.g. "19.90")`);

const taxRate = z
  .number()
  .min(0, 'taxRate must be >= 0')
  .max(100, 'taxRate must be <= 100');

const minStock = z.number().int('minStock must be an integer').min(0, 'minStock must be >= 0');

/** Sortable product fields, aligned with {@link ProductSortField}. */
const sortField = z.enum(['name', 'sku', 'price', 'createdAt', 'updatedAt']);
const sortDirection = z.enum(['asc', 'desc']);

/**
 * Parses a `sort` query param of the form `field` or `field:direction`
 * (e.g. `name`, `price:desc`) into `{ sortBy, sortDirection }`. Defaults the
 * direction to `asc` when omitted. Invalid fields/directions fail validation.
 */
const sortParam = z
  .string()
  .trim()
  .transform((value, ctx): { sortBy: z.infer<typeof sortField>; sortDirection: z.infer<typeof sortDirection> } => {
    const [rawField, rawDirection] = value.split(':');
    const fieldResult = sortField.safeParse(rawField);
    if (!fieldResult.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `sort field must be one of: name, sku, price, createdAt, updatedAt`,
      });
      return z.NEVER;
    }
    const direction = rawDirection ?? 'asc';
    const directionResult = sortDirection.safeParse(direction);
    if (!directionResult.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `sort direction must be "asc" or "desc"`,
      });
      return z.NEVER;
    }
    return { sortBy: fieldResult.data, sortDirection: directionResult.data };
  });

/** Coerced positive page number from the (string) query value. */
const page = z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1');

/** Coerced page size from the (string) query value. */
const pageSize = z.coerce
  .number()
  .int('pageSize must be an integer')
  .min(1, 'pageSize must be >= 1');

/** Boolean filter parsed from the query string literals `true`/`false`. */
const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** Create-product request body (tenant derived from the JWT). */
export const createProductBodySchema = z
  .object({
    categoryId: uuid('categoryId'),
    sku: z.string().trim().min(1, 'sku is required'),
    name: z.string().trim().min(1, 'name is required'),
    price: decimalString('price'),
    description: z.string().trim().min(1).nullish(),
    cost: decimalString('cost').nullish(),
    taxRate: taxRate.optional(),
    unit: z.string().trim().min(1).optional(),
    minStock: minStock.optional(),
    isActive: z.boolean().optional(),
    imageUrl: z.string().trim().url('imageUrl must be a valid URL').nullish(),
    currency: z.string().trim().length(3, 'currency must be a 3-letter ISO code').optional(),
  })
  .strict();

export type CreateProductBody = z.infer<typeof createProductBodySchema>;

/**
 * Update-product request body. Every field is optional; only provided fields
 * change. `null` clears the nullable fields (`description`, `cost`, `imageUrl`).
 */
export const updateProductBodySchema = z
  .object({
    categoryId: uuid('categoryId').optional(),
    sku: z.string().trim().min(1, 'sku is required').optional(),
    name: z.string().trim().min(1, 'name is required').optional(),
    price: decimalString('price').optional(),
    description: z.string().trim().min(1).nullish(),
    cost: decimalString('cost').nullish(),
    taxRate: taxRate.optional(),
    unit: z.string().trim().min(1).optional(),
    minStock: minStock.optional(),
    isActive: z.boolean().optional(),
    imageUrl: z.string().trim().url('imageUrl must be a valid URL').nullish(),
    currency: z.string().trim().length(3, 'currency must be a 3-letter ISO code').optional(),
  })
  .strict();

export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

/** Listing query string (page, pageSize, filters, sort). */
export const listProductsQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    categoryId: uuid('categoryId').optional(),
    isActive: booleanFlag.optional(),
    sort: sortParam.optional(),
  })
  .strip();

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/** Search query string (free-text `q` plus pagination/filters). */
export const searchProductsQuerySchema = z
  .object({
    q: z.string().trim().min(1, 'q is required'),
    page: page.optional(),
    pageSize: pageSize.optional(),
    categoryId: uuid('categoryId').optional(),
    isActive: booleanFlag.optional(),
  })
  .strip();

export type SearchProductsQuery = z.infer<typeof searchProductsQuerySchema>;

/** `:id` route param. */
export const productIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strip();

export type ProductIdParam = z.infer<typeof productIdParamSchema>;

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

const productOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid' },
    sku: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    price: { type: 'string' },
    cost: { type: ['string', 'null'] },
    currency: { type: 'string' },
    taxRate: { type: 'number' },
    priceWithTax: { type: 'string' },
    unit: { type: 'string' },
    minStock: { type: 'integer' },
    isActive: { type: 'boolean' },
    imageUrl: { type: ['string', 'null'] },
  },
} as const;

const pagedProductOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: productOutputSchema },
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

const createProductDocBody = {
  type: 'object',
  required: ['categoryId', 'sku', 'name', 'price'],
  properties: {
    categoryId: { type: 'string', format: 'uuid' },
    sku: { type: 'string' },
    name: { type: 'string' },
    price: { type: 'string', description: 'Decimal string, e.g. "19.90"' },
    description: { type: ['string', 'null'] },
    cost: { type: ['string', 'null'] },
    taxRate: { type: 'number', minimum: 0, maximum: 100 },
    unit: { type: 'string' },
    minStock: { type: 'integer', minimum: 0 },
    isActive: { type: 'boolean' },
    imageUrl: { type: ['string', 'null'], format: 'uri' },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
  },
} as const;

const updateProductDocBody = {
  type: 'object',
  properties: createProductDocBody.properties,
} as const;

const listQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    categoryId: { type: 'string', format: 'uuid' },
    isActive: { type: 'boolean' },
    sort: { type: 'string', description: 'field or field:direction, e.g. "price:desc"' },
  },
} as const;

const searchQueryDoc = {
  type: 'object',
  required: ['q'],
  properties: {
    q: { type: 'string' },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    categoryId: { type: 'string', format: 'uuid' },
    isActive: { type: 'boolean' },
  },
} as const;

const idParamDoc = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

/** OpenAPI schema for `POST /api/v1/products`. */
export const createProductRouteSchema = {
  tags: ['Products'],
  summary: 'Create a product',
  body: createProductDocBody,
  response: {
    201: productOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/products`. */
export const listProductsRouteSchema = {
  tags: ['Products'],
  summary: 'List products (paginated, filterable, sortable)',
  querystring: listQueryDoc,
  response: {
    200: pagedProductOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/products/search`. */
export const searchProductsRouteSchema = {
  tags: ['Products'],
  summary: 'Search products by name or SKU (paginated)',
  querystring: searchQueryDoc,
  response: {
    200: pagedProductOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/products/:id`. */
export const getProductRouteSchema = {
  tags: ['Products'],
  summary: 'Get a product by id',
  params: idParamDoc,
  response: {
    200: productOutputSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/products/:id`. */
export const updateProductRouteSchema = {
  tags: ['Products'],
  summary: 'Update a product',
  params: idParamDoc,
  body: updateProductDocBody,
  response: {
    200: productOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `DELETE /api/v1/products/:id`. */
export const deleteProductRouteSchema = {
  tags: ['Products'],
  summary: 'Soft-delete a product',
  params: idParamDoc,
  response: {
    204: { type: 'null', description: 'Product deleted' },
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;
