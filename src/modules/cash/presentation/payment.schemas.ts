import { z } from 'zod';
import { PAYMENT_METHODS } from '../domain/value-objects/payment-method.js';
import { PAYMENT_STATUSES } from '../domain/value-objects/payment-status.js';

/**
 * Request validation schemas for the payment endpoints (task 23.3).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateQuery}
 * helpers, which raise a domain {@link ValidationError} on failure; the central
 * error handler then maps that onto the consistent error envelope with
 * field-level messages (Requirements 25.5, 25.7). Validation failures surface as
 * HTTP 400.
 *
 * The `tenantId` and `userId` are intentionally NOT accepted from the client:
 * they are derived from the authenticated JWT (`request.auth`) so a caller can
 * never act across tenant boundaries or spoof the payment author
 * (Requirement 1.5). The domain enforces the *exactly one of sale/purchase*
 * link rule and the overpayment policy.
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the payment plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

/** A positive decimal amount as a string (e.g. `"50.00"`) or number. */
const amountField = z.union([
  z.string().trim().min(1, 'amount is required'),
  z.number().positive('amount must be positive'),
]);

const method = z.enum(PAYMENT_METHODS);
const textField = z.string().trim().min(1);

const page = z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1');
const pageSize = z.coerce
  .number()
  .int('pageSize must be an integer')
  .min(1, 'pageSize must be >= 1');
const dateBound = z.coerce.date();

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/**
 * Record-payment request body (tenant + user derived from the JWT). Exactly one
 * of `saleId`/`purchaseId` must be supplied — the `Payment` entity enforces the
 * link rule (an invalid link is a 400 `ValidationError`). `cashId` is only
 * consulted for `cash` payments.
 */
export const recordPaymentBodySchema = z
  .object({
    saleId: uuid('saleId').nullish(),
    purchaseId: uuid('purchaseId').nullish(),
    method,
    amount: amountField,
    reference: textField.nullish(),
    cashId: uuid('cashId').nullish(),
  })
  .strict();

export type RecordPaymentBody = z.infer<typeof recordPaymentBodySchema>;

/** List-payments query string (page, pageSize, filters). */
export const listPaymentsQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    saleId: uuid('saleId').optional(),
    purchaseId: uuid('purchaseId').optional(),
    method: method.optional(),
    from: dateBound.optional(),
    to: dateBound.optional(),
  })
  .strip();

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

/** Payment-status query string: provide exactly one of saleId/purchaseId. */
export const paymentStatusQuerySchema = z
  .object({
    saleId: uuid('saleId').optional(),
    purchaseId: uuid('purchaseId').optional(),
  })
  .strip();

export type PaymentStatusQuery = z.infer<typeof paymentStatusQuerySchema>;

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

const paymentOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    saleId: { type: ['string', 'null'], format: 'uuid' },
    purchaseId: { type: ['string', 'null'], format: 'uuid' },
    method: { type: 'string', enum: [...PAYMENT_METHODS] },
    amount: { type: 'string' },
    reference: { type: ['string', 'null'] },
    date: { type: 'string', format: 'date-time' },
  },
} as const;

const pagedPaymentOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: paymentOutputSchema },
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

const paymentStatusOutputSchema = {
  type: 'object',
  properties: {
    documentType: { type: 'string', enum: ['sale', 'purchase'] },
    documentId: { type: 'string', format: 'uuid' },
    total: { type: 'string' },
    paid: { type: 'string' },
    outstanding: { type: 'string' },
    status: { type: 'string', enum: [...PAYMENT_STATUSES] },
  },
  required: ['documentType', 'documentId', 'total', 'paid', 'outstanding', 'status'],
} as const;

const recordPaymentDocBody = {
  type: 'object',
  required: ['method', 'amount'],
  properties: {
    saleId: { type: ['string', 'null'], format: 'uuid' },
    purchaseId: { type: ['string', 'null'], format: 'uuid' },
    method: { type: 'string', enum: [...PAYMENT_METHODS] },
    amount: { type: ['string', 'number'] },
    reference: { type: ['string', 'null'] },
    cashId: {
      type: ['string', 'null'],
      format: 'uuid',
      description: 'For a cash payment, the register to credit/debit (moves the till)',
    },
  },
} as const;

const listPaymentsQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    saleId: { type: 'string', format: 'uuid' },
    purchaseId: { type: 'string', format: 'uuid' },
    method: { type: 'string', enum: [...PAYMENT_METHODS] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
} as const;

const paymentStatusQueryDoc = {
  type: 'object',
  properties: {
    saleId: { type: 'string', format: 'uuid' },
    purchaseId: { type: 'string', format: 'uuid' },
  },
} as const;

/** OpenAPI schema for `POST /api/v1/payments`. */
export const recordPaymentRouteSchema = {
  tags: ['Payments'],
  summary: 'Record a payment against a sale or a purchase (rejects overpayment)',
  body: recordPaymentDocBody,
  response: {
    201: paymentOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/payments`. */
export const listPaymentsRouteSchema = {
  tags: ['Payments'],
  summary: 'List payments (paginated, filterable by sale/purchase/method/date)',
  querystring: listPaymentsQueryDoc,
  response: {
    200: pagedPaymentOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/payments/status`. */
export const paymentStatusRouteSchema = {
  tags: ['Payments'],
  summary: 'Get the derived payment status of a sale or a purchase',
  querystring: paymentStatusQueryDoc,
  response: {
    200: paymentStatusOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;
