import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import { MAX_LOGO_SIZE_BYTES } from '@application/ports/storage.js';
import { StubStorageService } from './stub-storage-service.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function pngUpload(size = 16): { content: Buffer; contentType: string; filename: string } {
  return { content: Buffer.alloc(size, 1), contentType: 'image/png', filename: 'logo.png' };
}

describe('StubStorageService', () => {
  it('returns a deterministic, tenant-isolated URL for a valid logo', async () => {
    const storage = new StubStorageService();
    const url = await storage.uploadLogo(TENANT_ID, pngUpload());
    expect(url).toContain(`/uploads/tenants/${TENANT_ID}/branding/`);
    expect(url).toMatch(/\.png$/);
    expect(storage.storedCount).toBe(1);
  });

  it('is idempotent for identical content (same URL, no extra stored asset)', async () => {
    const storage = new StubStorageService();
    const first = await storage.uploadLogo(TENANT_ID, pngUpload());
    const second = await storage.uploadLogo(TENANT_ID, pngUpload());
    expect(second).toBe(first);
    expect(storage.storedCount).toBe(1);
  });

  it('namespaces assets per tenant', async () => {
    const storage = new StubStorageService();
    const a = await storage.uploadLogo(TENANT_ID, pngUpload());
    const b = await storage.uploadLogo('22222222-2222-2222-2222-222222222222', pngUpload());
    expect(a).not.toBe(b);
    expect(a).toContain(TENANT_ID);
    expect(b).toContain('22222222-2222-2222-2222-222222222222');
  });

  it('honours a custom base URL', async () => {
    const storage = new StubStorageService({ baseUrl: 'https://cdn.example.com/' });
    const url = await storage.uploadLogo(TENANT_ID, pngUpload());
    expect(url.startsWith('https://cdn.example.com/tenants/')).toBe(true);
  });

  it('accepts every allowed content type', async () => {
    const storage = new StubStorageService();
    for (const contentType of ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']) {
      const url = await storage.uploadLogo(TENANT_ID, {
        content: Buffer.from('<svg/>'),
        contentType,
      });
      expect(typeof url).toBe('string');
    }
  });

  it('rejects an unsupported content type with a ValidationError', async () => {
    const storage = new StubStorageService();
    await expect(
      storage.uploadLogo(TENANT_ID, { content: Buffer.alloc(4), contentType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(storage.storedCount).toBe(0);
  });

  it('rejects an empty file with a ValidationError', async () => {
    const storage = new StubStorageService();
    await expect(
      storage.uploadLogo(TENANT_ID, { content: Buffer.alloc(0), contentType: 'image/png' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a file exceeding the maximum size with a ValidationError', async () => {
    const storage = new StubStorageService();
    await expect(
      storage.uploadLogo(TENANT_ID, pngUpload(MAX_LOGO_SIZE_BYTES + 1)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(storage.storedCount).toBe(0);
  });

  it('accepts a file exactly at the maximum size', async () => {
    const storage = new StubStorageService();
    const url = await storage.uploadLogo(TENANT_ID, pngUpload(MAX_LOGO_SIZE_BYTES));
    expect(typeof url).toBe('string');
  });
});
