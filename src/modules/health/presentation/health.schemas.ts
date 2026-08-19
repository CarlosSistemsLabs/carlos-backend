/**
 * OpenAPI/Swagger documentation schemas for the health probes (task 31.2).
 *
 * These JSON-schema objects are attached to the routes purely for documentation
 * (Requirement 3.7). The probes take no input, so there is nothing to validate;
 * only response shapes are described.
 */

const livenessOutputSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
  },
  required: ['status'],
} as const;

const readinessOutputSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'not_ready'] },
    checks: {
      type: 'object',
      additionalProperties: { type: 'string', enum: ['up', 'down'] },
    },
    details: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
  required: ['status', 'checks'],
} as const;

/** OpenAPI schema for `GET /health/liveness`. */
export const livenessRouteSchema = {
  tags: ['Health'],
  summary: 'Liveness probe (process is up; performs no dependency checks)',
  response: {
    200: livenessOutputSchema,
  },
} as const;

/** OpenAPI schema for `GET /health/readiness`. */
export const readinessRouteSchema = {
  tags: ['Health'],
  summary: 'Readiness probe (aggregates dependency checks: database, …)',
  response: {
    200: readinessOutputSchema,
    503: readinessOutputSchema,
  },
} as const;
