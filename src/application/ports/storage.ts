import type { UUID } from '@shared/types/index.js';

/**
 * Cross-cutting cloud-storage abstraction port for branding assets (design
 * "Infrastructure Layer" → storage; Requirement 11.3 — store branding assets in
 * secure cloud storage with tenant isolation).
 *
 * Application code depends only on this framework-agnostic port. A local
 * {@link StubStorageService} backs it today (deterministic, tenant-isolated
 * URLs, no external SDK); the real cloud implementation (Firebase Storage /
 * S3) is wired later (task 33.x) **behind this exact same port**, so no
 * consumer changes are required when it lands. Tenant isolation is expressed by
 * requiring the `tenantId` on every upload so an implementation can namespace
 * assets per tenant (e.g. `tenants/<tenantId>/branding/...`).
 */
export interface IStorageService {
  /**
   * Validates and stores a tenant's logo asset, returning the URL under which
   * it is served. Implementations MUST reject an unsupported content type or an
   * oversized payload with a {@link ValidationError} (see
   * {@link ALLOWED_LOGO_CONTENT_TYPES} and {@link MAX_LOGO_SIZE_BYTES}).
   *
   * @throws {ValidationError} when the file's content type or size is invalid.
   */
  uploadLogo(tenantId: UUID, file: LogoUpload): Promise<string>;
}

/** A logo asset to upload: its raw bytes plus the metadata needed to validate it. */
export interface LogoUpload {
  /** Raw file bytes. */
  content: Buffer;
  /** MIME content type, e.g. `image/png`. */
  contentType: string;
  /** Original file name (used to derive a stored extension); optional. */
  filename?: string;
}

/**
 * Image content types accepted for a tenant logo. Raster (PNG/JPEG/WebP) plus
 * vector (SVG) cover every client platform (web/Android/iOS).
 */
export const ALLOWED_LOGO_CONTENT_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
];

/** Maximum accepted logo size in bytes (2 MiB). */
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
