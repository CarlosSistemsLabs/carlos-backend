import { z } from 'zod';
import { CASH_MOVEMENT_TYPES } from '../domain/value-objects/cash-movement-type.js';
import { CASH_MOVEMENT_CATEGORIES } from '../domain/value-objects/cash-movement-category.js';

/**
 * Request validation schemas for the cash-register endpoints (task 23.3).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateQuery}
 * helpers, which raise a domain {@link ValidationError} on failure; the central
 * error handler then maps that onto the consistent error envelope with
 * field-level messages (Requirements 25.5, 25.7). Validation failures surface as
 * HTTP 400 — the established platform convention.
 *
 * The `tenantId` and `userId` are intentionally NOT accepted from the client:
 * they are derived from the authenticated JWT (`request.auth`) so a caller can
 * never act across tenant boundaries or spoof the movement author
 * (Requirement 1.5).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the cash plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** A positive decimal amount as a string (e.g. `"100.00"`) or number. */
const amountField = z.union([
  z.string().trim().min(1, 'amount is required'),
  z.number().positive('amount must be positive'),
]);

const movementType = z.enum(CASH_MOVEMENT_TYPES);
const movementCategory = z.enum(CASH_MOVEMENT_CATEGORIES);

const textField = z.string().trim().min(1);

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

/** Open-cash-register request body (tenant + user derived from the JWT). */
export const openCashRegisterBodySchema = z
  .object({
    name: textField,
    branchId: uuid('branchId').nullish(),
    openingBalance: amountField.optional(),
  })
  .strict();

export type OpenCashRegisterBody = z.infer<typeof openCashRegisterBodySchema>;

/** Close-cash-register request body. */
export const closeCashRegisterBodySchema = z
  .object({
    cashId: uuid('cashId'),
    countedAmount: amountField,
  })
  .strict();

export type CloseCashRegisterBody = z.infer<typeof closeCashRegisterBodySchema>;

/** Record-cash-movement request body. */
export const recordCashMovementBodySchema = z
  .object({
    cashId: uuid('cashId'),
    type: movementType,
    category: movementCategory,
    amount: amountField,
    reference: textField.nullish(),
    description: textField.nullish(),
  })
  .strict();

export type RecordCashMovementBody = z.infer<typeof recordCashMovementBodySchema>;

/** List-cash-movements query string (page, pageSize, filters). */
export const listCashMovementsQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    cashId: uuid('cashId').optional(),
    type: movementType.optional(),
    category: movementCategory.optional(),
    from: dateBound.optional(),
    to: dateBound.optional(),
  })
  .strip();

export type ListCashMovementsQuery = z.infer<typeof listCashMovementsQuerySchema>;

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

const cashOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    name: { type: 'string' },
    currency: { type: 'string' },
    balance: { type: 'string' },
  },
} as const;

const cashMovementOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    cashId: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: [...CASH_MOVEMENT_TYPES] },
    category: { type: 'string', enum: [...CASH_MOVEMENT_CATEGORIES] },
    amount: { type: 'string' },
    reference: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    date: { type: 'string', format: 'date-time' },
  },
} as const;

const closeCashOutputSchema = {
  type: 'object',
  properties: {
    cash: cashOutputSchema,
    expected: { type: 'string' },
    counted: { type: 'string' },
    difference: { type: 'string' },
    reconciliationMovement: { ...cashMovementOutputSchema, nullable: true },
  },
  required: ['cash', 'expected', 'counted', 'difference'],
} as const;

const pagedCashMovementOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: cashMovementOutputSchema },
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

const openCashDocBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    branchId: { type: ['string', 'null'], format: 'uuid' },
    openingBalance: {
      type: ['string', 'number'],
      description: 'Optional opening float; a positive value books an INCOME/opening movement',
    },
  },
} as const;

const closeCashDocBody = {
  type: 'object',
  required: ['cashId', 'countedAmount'],
  properties: {
    cashId: { type: 'string', format: 'uuid' },
    countedAmount: { type: ['string', 'number'] },
  },
} as const;

const recordMovementDocBody = {
  type: 'object',
  required: ['cashId', 'type', 'category', 'amount'],
  properties: {
    cashId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: [...CASH_MOVEMENT_TYPES] },
    category: { type: 'string', enum: [...CASH_MOVEMENT_CATEGORIES] },
    amount: { type: ['string', 'number'] },
    reference: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
  },
} as const;

const listMovementsQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    cashId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: [...CASH_MOVEMENT_TYPES] },
    category: { type: 'string', enum: [...CASH_MOVEMENT_CATEGORIES] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
} as const;

/** OpenAPI schema for `POST /api/v1/cash/open`. */
export const openCashRegisterRouteSchema = {
  tags: ['Cash'],
  summary: 'Open a cash register (optionally with an opening float)',
  body: openCashDocBody,
  response: {
    201: cashOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/cash/close`. */
export const closeCashRegisterRouteSchema = {
  tags: ['Cash'],
  summary: 'Close a cash register with reconciliation (expected/counted/difference)',
  body: closeCashDocBody,
  response: {
    200: closeCashOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/cash/movements`. */
export const recordCashMovementRouteSchema = {
  tags: ['Cash'],
  summary: 'Record a cash movement (INCOME/EXPENSE) against a register',
  body: recordMovementDocBody,
  response: {
    201: cashMovementOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/cash/movements`. */
export const listCashMovementsRouteSchema = {
  tags: ['Cash'],
  summary: 'List cash movements (cash-flow history, paginated + filterable)',
  querystring: listMovementsQueryDoc,
  response: {
    200: pagedCashMovementOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;
