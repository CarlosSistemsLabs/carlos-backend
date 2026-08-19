import { ValidationError } from '@domain/errors/index.js';
import type { UUID } from '@shared/types/index.js';
import {
  ALLOWED_LOGO_CONTENT_TYPES,
  MAX_LOGO_SIZE_BYTES,
  type IStorageService,
  type LogoUpload,
} from '@application/ports/storage.js';

/** Maps an accepted image content type to a stored-file extension. */
const CONTENT_TYPE_EXTENSION: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

/** Options accepted by {@link StubStorageService}. */
export interface StubStorageOptions {
  /**
   * Base URL prefix under which stored logos are served. Defaults to a
   * relative `/uploads` path so the deterministic URL is environment-agnostic;
   * the real cloud implementation (task 33.x) returns its bucket URL instead.
   */
  baseUrl?: string;
}

/**
 * Local/stub {@link IStorageService} used until the cloud implementation
 * (Firebase Storage / S3) is wired in task 33.x behind the SAME port.
 *
 * It performs the real validation contract — rejecting an unsupported content
 * type or an oversized payload with a {@link ValidationError} — then returns a
 * deterministic, tenant-isolated URL derived from the tenant id and a content
 * hash: `{baseUrl}/tenants/<tenantId>/branding/<sha256>.<ext>`. Deriving the
 * name from the content hash makes re-uploading the same asset idempotent and
 * keeps assets namespaced per tenant (Requirement 11.3 — tenant isolation)
 * without persisting any bytes or reaching the network. The uploaded metadata
 * is retained in-memory purely so tests can assert what was "stored".
 */
export class StubStorageService implements IStorageService {
  private readonly baseUrl: string;
  private readonly uploads = new Map<string, LogoUpload>();

  constructor(options: StubStorageOptions = {}) {
    // Normalise away any trailing slash so URL construction stays clean.
    this.baseUrl = (options.baseUrl ?? '/uploads').replace(/\/+$/, '');
  }

  // `async` so a validation failure rejects the returned promise (port contract).
  async uploadLogo(tenantId: UUID, file: LogoUpload): Promise<string> {
    this.assertValid(file);

    const ext = CONTENT_TYPE_EXTENSION[file.contentType] ?? 'bin';
    const digest = StubStorageService.hash(file.content);
    const path = `tenants/${tenantId}/branding/${digest}.${ext}`;
    this.uploads.set(path, file);
    return `${this.baseUrl}/${path}`;
  }

  /** Test/inspection helper: the number of assets "stored" so far. */
  get storedCount(): number {
    return this.uploads.size;
  }

  private assertValid(file: LogoUpload): void {
    if (!ALLOWED_LOGO_CONTENT_TYPES.includes(file.contentType)) {
      throw new ValidationError(
        `Unsupported logo content type "${file.contentType}". Allowed: ${ALLOWED_LOGO_CONTENT_TYPES.join(', ')}`,
        { field: 'logo', value: file.contentType },
      );
    }
    if (file.content.byteLength === 0) {
      throw new ValidationError('Logo file must not be empty', { field: 'logo' });
    }
    if (file.content.byteLength > MAX_LOGO_SIZE_BYTES) {
      throw new ValidationError(
        `Logo file exceeds the maximum size of ${MAX_LOGO_SIZE_BYTES} bytes`,
        { field: 'logo', value: file.content.byteLength },
      );
    }
  }

  /**
   * Deterministic, dependency-free FNV-1a 32-bit hash rendered as hex. Used only
   * to derive a stable stored file name from the content; not a security hash.
   */
  private static hash(content: Buffer): string {
    let h = 0x811c9dc5;
    for (const byte of content) {
      h ^= byte;
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
