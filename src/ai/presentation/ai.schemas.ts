import { z } from 'zod';

/**
 * Request validation schemas for the AI integration endpoints (task 37.3,
 * Requirement 20.1).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody} helper, which raises a
 * domain {@link ValidationError} on failure; the central error handler then maps
 * that onto the consistent error envelope with field-level messages. Validation
 * failures surface as HTTP 400 — the established platform convention.
 *
 * The tenant context (`tenantId`, `userId`, `requestId`) is intentionally NOT
 * accepted from the client: it is derived from the authenticated JWT
 * (`request.auth`) and the request id so a caller can never act across tenant
 * boundaries (Requirement 20.3 — AI features operate strictly within a single
 * tenant's data).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the AI plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A single prior conversation turn supplied by the client. */
const salesAssistantMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1, 'content is required'),
  })
  .strict();

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** `POST /api/v1/ai/sales-assistant` request body. */
export const salesAssistantBodySchema = z
  .object({
    message: z.string().trim().min(1, 'message is required'),
    history: z.array(salesAssistantMessageSchema).optional(),
  })
  .strict();

export type SalesAssistantBody = z.infer<typeof salesAssistantBodySchema>;

/** `POST /api/v1/ai/query` request body. */
export const naturalLanguageQueryBodySchema = z
  .object({
    question: z.string().trim().min(1, 'question is required'),
  })
  .strict();

export type NaturalLanguageQueryBody = z.infer<typeof naturalLanguageQueryBodySchema>;

/** `POST /api/v1/ai/report-generate` request body. */
export const reportGenerateBodySchema = z
  .object({
    prompt: z.string().trim().min(1, 'prompt is required'),
    reportType: z.string().trim().min(1).optional(),
    data: z.array(z.record(z.unknown())).optional(),
  })
  .strict();

export type ReportGenerateBody = z.infer<typeof reportGenerateBodySchema>;

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

const usageSchema = {
  type: 'object',
  properties: {
    promptTokens: { type: 'integer' },
    completionTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    estimatedCost: { type: 'number' },
  },
} as const;

const salesAssistantBodyDoc = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string' },
    history: {
      type: 'array',
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string' },
        },
      },
    },
  },
} as const;

const salesAssistantOutputSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
    usage: usageSchema,
    // Present only on a graceful-degradation fallback body (Requirement 20.5).
    degraded: { type: 'boolean' },
    available: { type: 'boolean' },
  },
  required: ['reply'],
} as const;

const queryBodyDoc = {
  type: 'object',
  required: ['question'],
  properties: {
    question: { type: 'string' },
  },
} as const;

const queryOutputSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    structuredQuery: { type: 'object', additionalProperties: true },
    usage: usageSchema,
    // Present only on a graceful-degradation fallback body (Requirement 20.5).
    degraded: { type: 'boolean' },
    available: { type: 'boolean' },
  },
  required: ['answer'],
} as const;

const reportGenerateBodyDoc = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string' },
    reportType: { type: 'string' },
    data: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
} as const;

const reportGenerateOutputSchema = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['title', 'content'],
      },
    },
    usage: usageSchema,
    // Present only on a graceful-degradation fallback body (Requirement 20.5).
    degraded: { type: 'boolean' },
    available: { type: 'boolean' },
  },
  required: ['narrative'],
} as const;

/** OpenAPI schema for `POST /api/v1/ai/sales-assistant`. */
export const salesAssistantRouteSchema = {
  tags: ['AI'],
  summary: 'Conversational sales assistance (Enterprise plan)',
  body: salesAssistantBodyDoc,
  response: {
    200: salesAssistantOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    503: errorEnvelopeSchema,
    504: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/ai/query`. */
export const naturalLanguageQueryRouteSchema = {
  tags: ['AI'],
  summary: 'Natural-language query over tenant data (Enterprise plan)',
  body: queryBodyDoc,
  response: {
    200: queryOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    503: errorEnvelopeSchema,
    504: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/ai/report-generate`. */
export const reportGenerateRouteSchema = {
  tags: ['AI'],
  summary: 'AI-powered report generation (Enterprise plan)',
  body: reportGenerateBodyDoc,
  response: {
    200: reportGenerateOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    503: errorEnvelopeSchema,
    504: errorEnvelopeSchema,
  },
} as const;
