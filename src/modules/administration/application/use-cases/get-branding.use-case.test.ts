import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '@domain/errors/index.js';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { GetBrandingUseCase } from './get-branding.use-case.js';
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

describe('GetBrandingUseCase', () => {
  let tenant: Tenant;
  let tenants: ITenantRepository;
  let cache: InMemoryCache;
  let useCase: GetBrandingUseCase;

  beforeEach(() => {
    tenant = Tenant.create(
      { name: 'Acme', slug: 'acme', theme: 'dark', primaryColor: '#112233' },
      TENANT_ID,
    );
    tenants = makeTenants(tenant);
    cache = new InMemoryCache();
    useCase = new GetBrandingUseCase(tenants, cache);
  });

  it('loads from the repository and populates the cache on a miss', async () => {
    const result = await useCase.execute({ tenantId: TENANT_ID });

    expect(result).toMatchObject({ name: 'Acme', theme: 'dark', primaryColor: '#112233' });
    expect(tenants.findById).toHaveBeenCalledOnce();
    // The projection is now cached under the branding key.
    expect(await cache.get(brandingCacheKey(TENANT_ID))).toMatchObject({ name: 'Acme' });
  });

  it('serves a cache hit without touching the repository', async () => {
    await useCase.execute({ tenantId: TENANT_ID }); // miss → populate
    await useCase.execute({ tenantId: TENANT_ID }); // hit
    await useCase.execute({ tenantId: TENANT_ID }); // hit

    expect(tenants.findById).toHaveBeenCalledOnce();
  });

  it('throws NotFoundError when the tenant does not exist (and caches nothing)', async () => {
    tenants = makeTenants(undefined);
    useCase = new GetBrandingUseCase(tenants, cache);

    await expect(useCase.execute({ tenantId: 'missing' })).rejects.toBeInstanceOf(NotFoundError);
    expect(await cache.get(brandingCacheKey('missing'))).toBeNull();
  });

  it('honours a configured TTL when populating the cache', async () => {
    let now = 1000;
    cache = new InMemoryCache(() => now);
    useCase = new GetBrandingUseCase(tenants, cache, 30);

    await useCase.execute({ tenantId: TENANT_ID }); // populate with 30s TTL
    now += 31_000; // expire
    await useCase.execute({ tenantId: TENANT_ID }); // miss again → reload

    expect(tenants.findById).toHaveBeenCalledTimes(2);
  });

  // Graceful degradation (task 41.4, Requirement 27.7): branding is a
  // non-critical presentational read, so a transient live failure serves the
  // last-known-good snapshot rather than erroring the UI.
  describe('graceful degradation (stale-on-error)', () => {
    it('serves the last-known-good branding when a live read fails transiently', async () => {
      // First read succeeds → populates the fresh entry AND the stale snapshot.
      await useCase.execute({ tenantId: TENANT_ID });
      // Force a miss on the fresh entry so the next read hits the repository.
      await cache.del(brandingCacheKey(TENANT_ID));
      // The repository now fails with an opaque (transient) infrastructure error.
      (tenants.findById as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('database temporarily unavailable'),
      );

      const result = await useCase.execute({ tenantId: TENANT_ID });

      expect(result).toMatchObject({ name: 'Acme', theme: 'dark' });
    });

    it('surfaces the error when a live read fails and no snapshot exists yet', async () => {
      // No prior successful read → nothing to fall back to, so the error surfaces.
      (tenants.findById as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('database temporarily unavailable'),
      );

      await expect(useCase.execute({ tenantId: TENANT_ID })).rejects.toThrow(
        'database temporarily unavailable',
      );
    });

    it('does NOT serve stale branding for a genuinely missing tenant (404 still surfaces)', async () => {
      // A successful read first seeds a stale snapshot under the tenant key.
      await useCase.execute({ tenantId: TENANT_ID });
      await cache.del(brandingCacheKey(TENANT_ID));
      // The tenant is now reported as missing: a deliberate NotFound must NOT be
      // masked by the stale snapshot.
      (tenants.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(useCase.execute({ tenantId: TENANT_ID })).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
