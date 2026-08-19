import { z } from 'zod';
import { ACTIONS } from '@modules/authorization/index.js';

/**
 * Request validation schemas for the Administration (tenant admin) endpoints
 * under `/api/v1/admin` (task 27.2).
 *
 * These Zod schemas are the source of truth for input validation. The route
 * handlers run them via the shared {@link validateBody}/{@link validateParams}/
 * {@link validateQuery} helpers, which raise a domain {@link ValidationError} on
 * failure; the central error handler then maps that onto the consistent error
 * envelope with field-level messages (Requirements 25.5, 25.7). Validation
 * failures surface as HTTP 400 — the established platform convention.
 *
 * The `tenantId` is intentionally NOT accepted from the client on any admin
 * endpoint: it is derived from the authenticated JWT (`request.auth`) so an
 * admin can only create/manage users, roles and read audit logs WITHIN their
 * own tenant (Requirement 1.5).
 *
 * The JSON-schema objects further down are attached to the routes purely for
 * OpenAPI/Swagger documentation (Requirement 3.7); Fastify's own validation is
 * disabled within the admin plugin so it does not pre-empt the Zod checks.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = (field: string): z.ZodString => z.string().uuid(`${field} must be a valid UUID`);

const textField = z.string().trim().min(1);

/** A single RBAC permission grant (module/screen/action). */
const permissionSchema = z
  .object({
    module: textField,
    screen: textField,
    action: z.enum([ACTIONS.READ, ACTIONS.WRITE, ACTIONS.DELETE]),
  })
  .strict();

/** Coerced positive page number from the (string) query value. */
const page = z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1');

/** Coerced page size from the (string) query value. */
const pageSize = z.coerce
  .number()
  .int('pageSize must be an integer')
  .min(1, 'pageSize must be >= 1');

/** Coerced inclusive date bound from an ISO (string) query value. */
const dateBound = z.coerce.date();

/** Audit action filter — the three recorded verbs. */
const auditAction = z.enum(['CREATE', 'UPDATE', 'DELETE']);

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

/** Create-user request body (tenant derived from the admin's JWT). */
export const createUserBodySchema = z
  .object({
    email: z.string().trim().min(1, 'email is required').email('email format is invalid'),
    password: z.string().min(8, 'password must be at least 8 characters'),
    firstName: textField,
    lastName: textField,
    roleId: uuid('roleId'),
    phone: textField.nullish(),
  })
  .strict();

export type CreateUserBody = z.infer<typeof createUserBodySchema>;

/** Assign-role request body. */
export const assignRoleBodySchema = z
  .object({
    roleId: uuid('roleId'),
  })
  .strict();

export type AssignRoleBody = z.infer<typeof assignRoleBodySchema>;

/** Create-role request body. */
export const createRoleBodySchema = z
  .object({
    name: textField,
    description: textField.nullish(),
    permissions: z.array(permissionSchema).optional(),
  })
  .strict();

export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;

/** Update-role-permissions request body (full replacement set). */
export const updateRolePermissionsBodySchema = z
  .object({
    permissions: z.array(permissionSchema),
  })
  .strict();

export type UpdateRolePermissionsBody = z.infer<typeof updateRolePermissionsBodySchema>;

/** `:id` route param (user or role id). */
export const idParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strip();

export type IdParam = z.infer<typeof idParamSchema>;

/** Audit-log listing query string (filters + pagination). */
export const auditLogsQuerySchema = z
  .object({
    page: page.optional(),
    pageSize: pageSize.optional(),
    entityType: textField.optional(),
    entityId: textField.optional(),
    userId: uuid('userId').optional(),
    action: auditAction.optional(),
    from: dateBound.optional(),
    to: dateBound.optional(),
  })
  .strip();

export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;

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
    email: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    roleId: { type: 'string', format: 'uuid' },
    phone: { type: ['string', 'null'] },
    avatar: { type: ['string', 'null'] },
    isActive: { type: 'boolean' },
    lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

const permissionDocSchema = {
  type: 'object',
  required: ['module', 'screen', 'action'],
  properties: {
    module: { type: 'string' },
    screen: { type: 'string' },
    action: { type: 'string', enum: [ACTIONS.READ, ACTIONS.WRITE, ACTIONS.DELETE] },
  },
} as const;

const roleOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    isSystem: { type: 'boolean' },
    permissions: { type: 'array', items: permissionDocSchema },
  },
} as const;

const auditLogOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    userId: { type: ['string', 'null'], format: 'uuid' },
    entityType: { type: 'string' },
    entityId: { type: 'string' },
    action: { type: 'string' },
    oldValues: {},
    newValues: {},
    ipAddress: { type: ['string', 'null'] },
    userAgent: { type: ['string', 'null'] },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;

const pagedAuditLogOutputSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: auditLogOutputSchema },
    total: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
  required: ['items', 'total', 'page', 'pageSize', 'totalPages'],
} as const;

const createUserDocBody = {
  type: 'object',
  required: ['email', 'password', 'firstName', 'lastName', 'roleId'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    roleId: { type: 'string', format: 'uuid' },
    phone: { type: ['string', 'null'] },
  },
} as const;

const assignRoleDocBody = {
  type: 'object',
  required: ['roleId'],
  properties: { roleId: { type: 'string', format: 'uuid' } },
} as const;

const createRoleDocBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    permissions: { type: 'array', items: permissionDocSchema },
  },
} as const;

const updateRolePermissionsDocBody = {
  type: 'object',
  required: ['permissions'],
  properties: {
    permissions: { type: 'array', items: permissionDocSchema },
  },
} as const;

const idParamDoc = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

const auditLogsQueryDoc = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    entityType: { type: 'string' },
    entityId: { type: 'string' },
    userId: { type: 'string', format: 'uuid' },
    action: { type: 'string', enum: ['CREATE', 'UPDATE', 'DELETE'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
} as const;

/** OpenAPI schema for `POST /api/v1/admin/users`. */
export const createUserRouteSchema = {
  tags: ['Administration'],
  summary: 'Create a user within the caller tenant',
  body: createUserDocBody,
  response: {
    201: userOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/admin/users/:id/role`. */
export const assignRoleRouteSchema = {
  tags: ['Administration'],
  summary: 'Assign a role to a user within the caller tenant',
  params: idParamDoc,
  body: assignRoleDocBody,
  response: {
    200: userOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `POST /api/v1/admin/roles`. */
export const createRoleRouteSchema = {
  tags: ['Administration'],
  summary: 'Create a custom role (optionally with initial permissions)',
  body: createRoleDocBody,
  response: {
    201: roleOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/admin/roles/:id/permissions`. */
export const updateRolePermissionsRouteSchema = {
  tags: ['Administration'],
  summary: 'Replace a role permission set (system roles are protected)',
  params: idParamDoc,
  body: updateRolePermissionsDocBody,
  response: {
    200: roleOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
    422: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `GET /api/v1/admin/audit-logs`. */
export const auditLogsRouteSchema = {
  tags: ['Administration'],
  summary: 'List audit-log entries (tenant-scoped, filterable, paginated)',
  querystring: auditLogsQueryDoc,
  response: {
    200: pagedAuditLogOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
  },
} as const;
