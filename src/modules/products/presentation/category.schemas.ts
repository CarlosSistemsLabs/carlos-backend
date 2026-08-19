import { z } from 'zod';

/**
 * Request validation schemas for the category endpoints (task 13.4).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateParams}
 * helpers, which raise a domain {@link ValidationError} on failure; the central
 * error handler maps that onto the consistent 400 envelope with field-level
 * messages (Requirements 25.5, 25.7).
 *
 * `tenantId` is intentionally NOT accepted from the client: it is derived from
 * the authenticated JWT (`request.auth.tenantId`) so a caller can never act
 * across tenant boundaries (Requirement 1.5).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the category plugin so it does not pre-empt the Zod checks.
 */

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** Create-category request body (tenant derived from the JWT). */
export const createCategoryBodySchema = z
  .object({
    name: z.string().trim().min(1, 'name is required'),
    description: z.string().trim().min(1).nullish(),
    parentId: uuid('parentId').nullish(),
  })
  .strict();

export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

/**
 * Update-category request body. Every field is optional; only provided fields
 * change. `parentId: null` detaches the category (makes it a root);
 * `description: null` clears the description.
 */
export const updateCategoryBodySchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').optional(),
    description: z.string().trim().min(1).nullish(),
    parentId: uuid('parentId').nullish(),
  })
  .strict();

export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

/** `:id` route param. */
export const categoryIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strip();

export type CategoryIdParam = z.infer<typeof categoryIdParamSchema>;

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

const categoryOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    parentId: { type: ['string', 'null'], format: 'uuid' },
  },
} as const;

const categoryListSchema = {
  type: 'array',
  items: categoryOutputSchema,
} as const;

/** Recursive tree node — `children` is documented as a free-form array to keep
 * the JSON-schema acyclic (Fastify/Swagger do not handle `$ref` self-cycles
 * well in inline schemas). */
const categoryTreeSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      description: { type: ['string', 'null'] },
      parentId: { type: ['string', 'null'], format: 'uuid' },
      children: { type: 'array' },
    },
  },
} as const;

const createCategoryDocBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    parentId: { type: ['string', 'null'], format: 'uuid' },
  },
} as const;

const updateCategoryDocBody = {
  type: 'object',
  properties: createCategoryDocBody.properties,
} as const;

const idParamDoc = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

/** OpenAPI schema for `POST /api/v1/categories`. */
export const createCategoryRouteSchema = {
  tags: ['Categories'],
  summary: 'Create a category',
  body: createCategoryDocBody,
  response: {
    201: categoryOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/categories`. */
export const listCategoriesRouteSchema = {
  tags: ['Categories'],
  summary: 'List categories (flat)',
  response: {
    200: categoryListSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/categories/tree`. */
export const getCategoryTreeRouteSchema = {
  tags: ['Categories'],
  summary: 'Get the hierarchical category tree',
  response: {
    200: categoryTreeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/categories/:id`. */
export const getCategoryRouteSchema = {
  tags: ['Categories'],
  summary: 'Get a category by id',
  params: idParamDoc,
  response: {
    200: categoryOutputSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/categories/:id`. */
export const updateCategoryRouteSchema = {
  tags: ['Categories'],
  summary: 'Update a category (rename / reparent)',
  params: idParamDoc,
  body: updateCategoryDocBody,
  response: {
    200: categoryOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `DELETE /api/v1/categories/:id`. */
export const deleteCategoryRouteSchema = {
  tags: ['Categories'],
  summary: 'Soft-delete a category (rejected when it has children or products)',
  params: idParamDoc,
  response: {
    204: { type: 'null', description: 'Category deleted' },
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;
