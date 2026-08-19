import { z } from 'zod';

/**
 * Request validation schemas for the authentication endpoints (task 8.4).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody} helper, which raises a
 * domain {@link ValidationError} on failure; the central error handler then
 * maps that onto the consistent 400 envelope with field-level messages
 * (Requirements 3.6, 25.5, 25.7).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the auth plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/**
 * Tenant identifier accepted on the public auth routes.
 *
 * ASSUMPTION (documented for task 8.4): registration and login happen before
 * any authenticated request context exists, so there is no JWT to derive the
 * tenant from. Until a tenant-resolution strategy (e.g. subdomain/slug lookup)
 * is introduced, the tenant is supplied explicitly in the request body as a
 * UUID. Login/refresh/logout follow the same convention for consistency.
 */
const tenantId = z.string().uuid('tenantId must be a valid UUID');

/** Registration request body. */
export const registerBodySchema = z
  .object({
    tenantId,
    email: z.string().trim().min(1, 'email is required').email('email format is invalid'),
    password: z.string().min(8, 'password must be at least 8 characters'),
    firstName: z.string().trim().min(1, 'firstName is required'),
    lastName: z.string().trim().min(1, 'lastName is required'),
    roleId: z.string().uuid('roleId must be a valid UUID'),
    phone: z.string().trim().min(1).nullish(),
  })
  .strict();

export type RegisterBody = z.infer<typeof registerBodySchema>;

/** Login request body. */
export const loginBodySchema = z
  .object({
    tenantId,
    email: z.string().trim().min(1, 'email is required').email('email format is invalid'),
    password: z.string().min(1, 'password is required'),
  })
  .strict();

export type LoginBody = z.infer<typeof loginBodySchema>;

/** Token-refresh request body. */
export const refreshBodySchema = z
  .object({
    refreshToken: z.string().trim().min(1, 'refreshToken is required'),
  })
  .strict();

export type RefreshBody = z.infer<typeof refreshBodySchema>;

/** Logout request body. */
export const logoutBodySchema = z
  .object({
    refreshToken: z.string().trim().min(1, 'refreshToken is required'),
    tenantId: tenantId.optional(),
  })
  .strict();

export type LogoutBody = z.infer<typeof logoutBodySchema>;

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

const userOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    roleId: { type: 'string', format: 'uuid' },
    phone: { type: ['string', 'null'] },
    avatar: { type: ['string', 'null'] },
    isActive: { type: 'boolean' },
    lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

const tokensSchema = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
  },
  required: ['accessToken', 'refreshToken'],
} as const;

/** OpenAPI schema for `POST /api/v1/auth/register`. */
export const registerRouteSchema = {
  tags: ['Auth'],
  summary: 'Register a new user within a tenant',
  body: {
    type: 'object',
    required: ['tenantId', 'email', 'password', 'firstName', 'lastName', 'roleId'],
    properties: {
      tenantId: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8 },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      roleId: { type: 'string', format: 'uuid' },
      phone: { type: ['string', 'null'] },
    },
  },
  response: {
    201: userOutputSchema,
    400: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/auth/login`. */
export const loginRouteSchema = {
  tags: ['Auth'],
  summary: 'Authenticate a user and issue an access/refresh token pair',
  body: {
    type: 'object',
    required: ['tenantId', 'email', 'password'],
    properties: {
      tenantId: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      password: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        user: userOutputSchema,
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
      required: ['user', 'accessToken', 'refreshToken'],
    },
    401: errorEnvelopeSchema,
    400: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/auth/refresh`. */
export const refreshRouteSchema = {
  tags: ['Auth'],
  summary: 'Exchange a refresh token for a new access/refresh token pair',
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string' },
    },
  },
  response: {
    200: tokensSchema,
    401: errorEnvelopeSchema,
    400: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/auth/logout`. */
export const logoutRouteSchema = {
  tags: ['Auth'],
  summary: 'Revoke a refresh token (logout)',
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string' },
      tenantId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    204: { type: 'null', description: 'Logout succeeded' },
    400: errorEnvelopeSchema,
  },
} as const;
