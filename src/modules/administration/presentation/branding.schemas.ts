import { z } from 'zod';

/**
 * Request validation schemas for the tenant Branding endpoints under
 * `/api/v1/branding` (task 27.3).
 *
 * **Logo upload transport decision.** `@fastify/multipart` is NOT a project
 * dependency, and this task is intentionally dependency-free, so a logo is
 * uploaded as a base64-encoded payload inside the JSON body (`logoFile`) rather
 * than as a `multipart/form-data` file part. The route handler decodes it to a
 * `Buffer` and hands it to the storage port, which validates the content type +
 * size. The real cloud storage integration (task 33.x) can switch to multipart
 * behind the same use case without changing the branding contract for clients
 * that send a `logo` URL directly. Clients may alternatively pass a pre-hosted
 * `logo` URL string (or `null` to clear it) instead of uploading bytes.
 *
 * As with the admin schemas, the `tenantId` is never accepted from the client:
 * it is derived from the authenticated JWT (`request.auth`) so branding can only
 * be read/updated within the caller's own tenant (Requirement 1.5). Colour and
 * theme values are NOT re-validated here — the {@link Tenant} value objects own
 * that, surfacing a consistent 400 on a malformed value.
 */

const textField = z.string().trim().min(1);

/** Base64-encoded logo upload payload. */
const logoFileSchema = z
  .object({
    /** Base64-encoded file bytes. */
    data: z.string().min(1, 'logoFile.data is required'),
    /** MIME content type, e.g. `image/png`. */
    contentType: textField,
    /** Original file name (optional). */
    filename: textField.optional(),
  })
  .strict();

/** Update-branding request body. Every field is optional (partial update). */
export const updateBrandingBodySchema = z
  .object({
    name: textField.optional(),
    /** Pre-hosted logo URL, or `null` to clear. Ignored when `logoFile` is set. */
    logo: z.string().trim().nullish(),
    /** Base64 logo upload; when present its stored URL becomes the logo. */
    logoFile: logoFileSchema.optional(),
    primaryColor: z.string().trim().nullish(),
    secondaryColor: z.string().trim().nullish(),
    theme: z.string().trim().optional(),
    language: textField.optional(),
    timezone: textField.optional(),
    currency: textField.optional(),
    dateFormat: textField.optional(),
    taxId: z.string().trim().nullish(),
  })
  .strict();

export type UpdateBrandingBody = z.infer<typeof updateBrandingBodySchema>;

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

/** Public branding projection returned by both endpoints. */
const brandingOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    slug: { type: 'string' },
    logo: { type: ['string', 'null'] },
    primaryColor: { type: ['string', 'null'] },
    secondaryColor: { type: ['string', 'null'] },
    theme: { type: 'string', enum: ['light', 'dark'] },
    language: { type: 'string' },
    timezone: { type: 'string' },
    currency: { type: 'string' },
    dateFormat: { type: 'string' },
    taxId: { type: ['string', 'null'] },
  },
} as const;

const updateBrandingDocBody = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    logo: { type: ['string', 'null'] },
    logoFile: {
      type: 'object',
      required: ['data', 'contentType'],
      properties: {
        data: { type: 'string', description: 'Base64-encoded logo bytes' },
        contentType: {
          type: 'string',
          enum: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
        },
        filename: { type: 'string' },
      },
    },
    primaryColor: { type: ['string', 'null'] },
    secondaryColor: { type: ['string', 'null'] },
    theme: { type: 'string', enum: ['light', 'dark'] },
    language: { type: 'string' },
    timezone: { type: 'string' },
    currency: { type: 'string' },
    dateFormat: { type: 'string' },
    taxId: { type: ['string', 'null'] },
  },
} as const;

/** OpenAPI schema for `GET /api/v1/branding`. */
export const getBrandingRouteSchema = {
  tags: ['Branding'],
  summary: "Read the authenticated tenant's branding configuration",
  response: {
    200: brandingOutputSchema,
    401: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;

/** OpenAPI schema for `PUT /api/v1/branding`. */
export const updateBrandingRouteSchema = {
  tags: ['Branding'],
  summary: "Update the authenticated tenant's branding (admin only)",
  body: updateBrandingDocBody,
  response: {
    200: brandingOutputSchema,
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    404: errorEnvelopeSchema,
  },
} as const;
