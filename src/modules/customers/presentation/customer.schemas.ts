import { z } from 'zod';

/**
 * Request validation schemas for the customer endpoints (task 17.2).
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
 * disabled within the customer plugin so it does not pre-empt the Zod checks.
 *
 * The field-level format checks mirror the domain value objects
 * ({@link Email}, {@link Phone}, {@link TaxId}) so obviously malformed input is
 * rejected at the edge; the value objects remain the ultimate authority and
 * re-validate/normalise the same values in the use cases.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** Optional-but-well-formed email; matches the {@link Email} value object. */
const emailField = z
  .string()
  .trim()
  .max(254, 'email exceeds the maximum allowed length')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'email format is invalid');

/** Optional-but-well-formed phone; matches the {@link Phone} value object. */
const phoneField = z
  .string()
  .trim()
  .regex(/^[+\d\s().-]+$/, 'phone contains invalid characters')
  .refine(
    (value) => {
      const digits = value.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15;
    },
    { message: 'phone must contain between 7 and 15 digits' },
  );

/** Optional-but-well-formed tax id; matches the {@link TaxId} value object. */
const taxIdField = z
  .string()
  .trim()
  .min(4, 'taxId must be between 4 and 32 characters')
  .max(32, 'taxId must be between 4 and 32 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'taxId may only contain letters, digits and hyphens');

const nameField = z.string().trim().min(1, 'name is required');
const addressField = z.string().trim().min(1);
const notesField = z.string().trim().min(1);

/** Sortable customer fields, aligned with {@link CustomerSortField}. */
const sortField = z.enum(['name', 'email', 'createdAt', 'updatedAt']);
const sortDirection = z.enum(['asc', 'desc']);

/**
 * Parses a `sort` query param of the form `field` or `field:direction`
 * (e.g. `name`, `name:desc`) into `{ sortBy, sortDirection }`. Defaults the
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
        message: `sort field must be one of: name, email, createdAt, updatedAt`,
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
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** Create-customer request body (tenant derived from the JWT). */
export const createCustomerBodySchema = z
  .object({
    name: nameField,
    email: emailField.nullish(),
    phone: phoneField.nullish(),
    taxId: taxIdField.nullish(),
    address: addressField.nullish(),
    notes: notesField.nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;

/**
 * Update-customer request body. Every field is optional; only provided fields
 * change. `null` clears the nullable fields (`email`, `phone`, `taxId`,
 * `address`, `notes`).
 */
export const updateCustomerBodySchema = z
  .object({
    name: nameField.optional(),
    email: emailField.nullish(),
    phone: phoneField.nullish(),
    taxId: taxIdField.nullish(),
    address: addressField.nullish(),
    notes: notesField.nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;

/** Listing query string (page, pageSize, filters, sort). */
export const listCustomersQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    isActive: booleanFlag.optional(),
    sort: sortParam.optional(),
  })
  .strip();

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/** Search query string (free-text `q` plus pagination/filter). */
export const searchCustomersQuerySchema = z
  .object({
    q: z.string().trim().min(1, 'q is required'),
    page: page.optional(),
    pageSize: pageSize.optional(),
    isActive: booleanFlag.optional(),
  })
  .strip();

export type SearchCustomersQuery = z.infer<typeof searchCustomersQuerySchema>;

/** `:id` route param. */
export const customerIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strip();

export type CustomerIdParam = z.infer<typeof customerIdParamSchema>;

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

const customerOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    taxId: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    isActive: { type: 'boolean' },
  },
} as const;

const pagedCustomerOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: customerOutputSchema },
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

const createCustomerDocBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    email: { type: ['string', 'null'], format: 'email' },
    phone: { type: ['string', 'null'] },
    taxId: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    isActive: { type: 'boolean' },
  },
} as const;

const updateCustomerDocBody = {
  type: 'object',
  properties: createCustomerDocBody.properties,
} as const;

const listQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    isActive: { type: 'boolean' },
    sort: { type: 'string', description: 'field or field:direction, e.g. "name:desc"' },
  },
} as const;

const searchQueryDoc = {
  type: 'object',
  required: ['q'],
  properties: {
    q: { type: 'string' },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    isActive: { type: 'boolean' },
  },
} as const;

const idParamDoc = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

/** OpenAPI schema for `POST /api/v1/customers`. */
export const createCustomerRouteSchema = {
  tags: ['Customers'],
  summary: 'Create a customer',
  body: createCustomerDocBody,
  response: {
    201: customerOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/customers`. */
export const listCustomersRouteSchema = {
  tags: ['Customers'],
  summary: 'List customers (paginated, filterable, sortable)',
  querystring: listQueryDoc,
  response: {
    200: pagedCustomerOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/customers/search`. */
export const searchCustomersRouteSchema = {
  tags: ['Customers'],
  summary: 'Search customers by name, email, phone or tax id (paginated)',
  querystring: searchQueryDoc,
  response: {
    200: pagedCustomerOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/customers/:id`. */
export const getCustomerRouteSchema = {
  tags: ['Customers'],
  summary: 'Get a customer by id',
  params: idParamDoc,
  response: {
    200: customerOutputSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/customers/:id`. */
export const updateCustomerRouteSchema = {
  tags: ['Customers'],
  summary: 'Update a customer',
  params: idParamDoc,
  body: updateCustomerDocBody,
  response: {
    200: customerOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `DELETE /api/v1/customers/:id`. */
export const deleteCustomerRouteSchema = {
  tags: ['Customers'],
  summary: 'Soft-delete a customer',
  params: idParamDoc,
  response: {
    204: { type: 'null', description: 'Customer deleted' },
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;
