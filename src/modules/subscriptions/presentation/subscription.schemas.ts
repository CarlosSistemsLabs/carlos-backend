import { z } from 'zod';
import { BILLING_CYCLES } from '../domain/value-objects/billing-cycle.js';
import { SUBSCRIPTION_STATUSES } from '../domain/value-objects/subscription-status.js';

/**
 * Request validation schemas for the subscription-management endpoints
 * (task 29.3).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateParams}
 * helpers, which raise a domain {@link ValidationError} on failure; the central
 * error handler then maps that onto the consistent error envelope with
 * field-level messages. Validation failures surface as HTTP 400 — the
 * established platform convention.
 *
 * The `tenantId` is intentionally NOT accepted from the client: it is derived
 * from the authenticated JWT (`request.auth`) so a caller can never act across
 * tenant boundaries (Requirement 1.5).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the subscriptions plugin so it does not pre-empt the Zod
 * checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** Create-subscription request body (tenant derived from the JWT). */
export const createSubscriptionBodySchema = z
  .object({
    planId: uuid('planId'),
  })
  .strict();

export type CreateSubscriptionBody = z.infer<typeof createSubscriptionBodySchema>;

/** Upgrade-subscription request body (subscription id comes from the path). */
export const upgradeSubscriptionBodySchema = z
  .object({
    planId: uuid('planId'),
  })
  .strict();

export type UpgradeSubscriptionBody = z.infer<typeof upgradeSubscriptionBodySchema>;

/** `:id` path parameter for the upgrade route. */
export const subscriptionIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strip();

export type SubscriptionIdParam = z.infer<typeof subscriptionIdParamSchema>;

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

const planOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    displayName: { type: 'string' },
    description: { type: ['string', 'null'] },
    price: { type: 'string' },
    currency: { type: 'string' },
    billingCycle: { type: 'string', enum: [...BILLING_CYCLES] },
    features: { type: 'array', items: { type: 'string' } },
    isActive: { type: 'boolean' },
  },
} as const;

const subscriptionOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    planId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: [...SUBSCRIPTION_STATUSES] },
    startDate: { type: 'string', format: 'date-time' },
    endDate: { type: ['string', 'null'], format: 'date-time' },
    autoRenew: { type: 'boolean' },
  },
} as const;

const currentSubscriptionOutputSchema = {
  type: 'object',
  properties: {
    subscription: subscriptionOutputSchema,
    plan: planOutputSchema,
    currentStatus: { type: 'string', enum: ['active', 'expired'] },
    endDate: { type: ['string', 'null'], format: 'date-time' },
  },
  required: ['subscription', 'plan', 'currentStatus'],
} as const;

const planListOutputSchema = {
  type: 'array',
  items: planOutputSchema,
} as const;

const createSubscriptionDocBody = {
  type: 'object',
  required: ['planId'],
  properties: {
    planId: { type: 'string', format: 'uuid' },
  },
} as const;

const upgradeSubscriptionDocBody = {
  type: 'object',
  required: ['planId'],
  properties: {
    planId: { type: 'string', format: 'uuid' },
  },
} as const;

const subscriptionIdParamDoc = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

/** OpenAPI schema for `POST /api/v1/subscriptions`. */
export const createSubscriptionRouteSchema = {
  tags: ['Subscriptions'],
  summary: 'Subscribe the tenant to a plan (supersedes any prior active subscription)',
  body: createSubscriptionDocBody,
  response: {
    201: subscriptionOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/subscriptions/current`. */
export const getCurrentSubscriptionRouteSchema = {
  tags: ['Subscriptions'],
  summary: "Get the caller tenant's current subscription joined with its plan",
  response: {
    200: currentSubscriptionOutputSchema,
    401: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/subscriptions/:id/upgrade`. */
export const upgradeSubscriptionRouteSchema = {
  tags: ['Subscriptions'],
  summary: 'Switch a subscription to a different plan (upgrade/downgrade)',
  params: subscriptionIdParamDoc,
  body: upgradeSubscriptionDocBody,
  response: {
    200: subscriptionOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/plans`. */
export const listPlansRouteSchema = {
  tags: ['Subscriptions'],
  summary: 'List the active plans available for subscription (public catalogue)',
  response: {
    200: planListOutputSchema,
    401: errorEnvelopeSchema,
  },
} as const;
