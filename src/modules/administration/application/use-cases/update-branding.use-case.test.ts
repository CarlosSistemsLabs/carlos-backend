import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '@domain/errors/index.js';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { StubStorageService } from '@infrastructure/storage/stub-storage-service.js';
import type { IStorageService, LogoUpload } from '@application/ports/storage.js';
import { UpdateBrandingUseCase } from './update-branding.use-case.js';
import { brandingCacheKey } from '../dto/administration-dtos.js';
import { Tenant } from '../../domain/entities/tenant.js';
import type { ITenantRepository } from '../../domain/repositories/tenant-repository.js';

const TENANT_ID = 'tenant-1';

function makeTenants(seed?: Tenant): ITenantRepository {
  return {
    findById: vi.fn().mockResolvedValue(seed ?? null),
    findBySlug: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (t: Tenant) => t),
    update: vi.fn(async (t: Tenant) => t),
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
}

function pngUpload(): LogoUpload {
  return { content: Buffer.alloc(32, 7), contentType: 'image/png', filename: 'logo.png' };
}

describe('UpdateBrandingUseCase', () => {
  let tenant: Tenant;
  let tenants: ITenantRepository;
  let storage: StubStorageService;
  let cache: InMemoryCache;
  let useCase: UpdateBrandingUseCase;

  beforeEach(() => {
    tenant = Tenant.create({ name: 'Acme', slug: 'acme', theme: 'light' }, TENANT_ID);
    tenants = makeTenants(tenant);
    storage = new StubStorageService();
    cache = new InMemoryCache();
    useCase = new UpdateBrandingUseCase(tenants, storage, cache);
  });

  it('uploads a logo file and sets the returned URL as the tenant logo', async () => {
    const result = await useCase.execute({ id: TENANT_ID, logoFile: pngUpload() });

    expect(storage.storedCount).toBe(1);
    expect(result.logo).toContain(`/uploads/tenants/${TENANT_ID}/branding/`);
    expect(tenants.update).toHaveBeenCalledOnce();
  });

  it('updates plain branding fields and persists them', async () => {
    const result = await useCase.execute({
      id: TENANT_ID,
      name: 'Acme LLC',
      theme: 'dark',
      secondaryColor: '#abc',
    });

    expect(result.name).toBe('Acme LLC');
    expect(result.theme).toBe('dark');
    expect(result.secondaryColor).toBe('#aabbcc');
    expect(storage.storedCount).toBe(0); // no logo upload attempted
  });

  it('prefers the uploaded logo over a logo URL when both are given', async () => {
    const result = await useCase.execute({
      id: TENANT_ID,
      logo: 'https://old.example.com/logo.png',
      logoFile: pngUpload(),
    });
    expect(result.logo).toContain('/uploads/tenants/');
    expect(result.logo).not.toBe('https://old.example.com/logo.png');
  });

  it('invalidates the branding cache after a successful update', async () => {
    // Pre-populate a stale branding entry.
    await cache.set(brandingCacheKey(TENANT_ID), { name: 'Stale' });

    await useCase.execute({ id: TENANT_ID, name: 'Fresh' });

    expect(await cache.get(brandingCacheKey(TENANT_ID))).toBeNull();
  });

  it('throws NotFoundError when the tenant does not exist', async () => {
    tenants = makeTenants(undefined);
    useCase = new UpdateBrandingUseCase(tenants, storage, cache);

    await expect(useCase.execute({ id: 'missing', name: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(tenants.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed color without uploading, persisting or touching the cache', async () => {
    await cache.set(brandingCacheKey(TENANT_ID), { name: 'Cached' });

    await expect(
      useCase.execute({ id: TENANT_ID, primaryColor: 'not-a-color' }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(tenants.update).not.toHaveBeenCalled();
    // The stale cache entry is left untouched (no invalidation on a failed write).
    expect(await cache.get(brandingCacheKey(TENANT_ID))).toEqual({ name: 'Cached' });
  });

  it('rejects an invalid theme without persisting', async () => {
    await expect(useCase.execute({ id: TENANT_ID, theme: 'rainbow' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(tenants.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid logo file (bad content type) before persisting', async () => {
    const badStorage: IStorageService = {
      uploadLogo: vi.fn(async () => {
        throw new ValidationError('bad content type', { field: 'logo' });
      }),
    };
    useCase = new UpdateBrandingUseCase(tenants, badStorage, cache);

    await expect(
      useCase.execute({
        id: TENANT_ID,
        logoFile: { content: Buffer.alloc(4), contentType: 'application/pdf' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(tenants.update).not.toHaveBeenCalled();
  });

  it('clears the logo when passed logo: null (no file)', async () => {
    tenant = Tenant.create(
      { name: 'Acme', slug: 'acme', logo: 'https://x/logo.png' },
      TENANT_ID,
    );
    tenants = makeTenants(tenant);
    useCase = new UpdateBrandingUseCase(tenants, storage, cache);

    const result = await useCase.execute({ id: TENANT_ID, logo: null });
    expect(result.logo).toBeNull();
  });
});
