import { NotFoundError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import type { IStorageService } from '@application/ports/storage.js';
import type { ITenantRepository } from '../../domain/repositories/tenant-repository.js';
import {
  brandingCacheKey,
  brandingStaleCacheKey,
  toTenantOutput,
  type TenantOutput,
  type UpdateBrandingInputDto,
} from '../dto/administration-dtos.js';

/**
 * Updates a tenant's branding/customization configuration WITH cloud-storage
 * integration and cache invalidation (task 27.3; Requirements 11.1, 11.3,
 * 11.4).
 *
 * This use case wraps the plain branding update
 * ({@link UpdateTenantBrandingUseCase}) with the two infrastructure concerns
 * task 27.3 adds:
 *
 * 1. **Logo upload (Requirement 11.3).** When an `input.logoFile` is provided,
 *    its bytes are uploaded through the {@link IStorageService} port (which
 *    validates the content type + size and stores the asset with tenant
 *    isolation) and the returned URL becomes the tenant's `logo`. The uploaded
 *    URL takes precedence over any `logo` URL field on the input. When no file
 *    is supplied the branding is updated from the fields alone (and `logo` may
 *    still be set/cleared as a plain URL string).
 * 2. **Cache invalidation (Requirement 11.4).** After a successful persist the
 *    tenant's branding cache entry is deleted so the next {@link GetBrandingUseCase}
 *    read reflects the change immediately (well within the 30-second budget).
 *
 * Every visual field is re-validated by the {@link Tenant} entity's value
 * objects; validation failures propagate as {@link ValidationError} and — since
 * they occur before persistence — leave both the store and the cache untouched.
 *
 * @throws {NotFoundError} when the tenant does not exist (or is soft-deleted).
 * @throws {ValidationError} when the logo file or a branding field is invalid.
 */
export class UpdateBrandingUseCase {
  constructor(
    private readonly tenants: ITenantRepository,
    private readonly storage: IStorageService,
    private readonly cache: ICache,
  ) {}

  async execute(input: UpdateBrandingInputDto): Promise<TenantOutput> {
    const tenant = await this.tenants.findById(input.id);
    if (tenant === null) {
      throw NotFoundError.forEntity('Tenant', input.id);
    }

    // Upload the logo asset first (if provided). A validation failure here
    // aborts before any persistence, so the tenant + cache stay consistent.
    // The uploaded URL wins over any `logo` URL field on the input.
    let logoPatch: { logo?: string | null } = {};
    if (input.logoFile !== undefined) {
      logoPatch = { logo: await this.storage.uploadLogo(input.id, input.logoFile) };
    } else if ('logo' in input) {
      logoPatch = { logo: input.logo };
    }

    tenant.updateBranding({
      ...('name' in input ? { name: input.name } : {}),
      ...logoPatch,
      ...('primaryColor' in input ? { primaryColor: input.primaryColor } : {}),
      ...('secondaryColor' in input ? { secondaryColor: input.secondaryColor } : {}),
      ...('theme' in input ? { theme: input.theme } : {}),
      ...('language' in input ? { language: input.language } : {}),
      ...('timezone' in input ? { timezone: input.timezone } : {}),
      ...('currency' in input ? { currency: input.currency } : {}),
      ...('dateFormat' in input ? { dateFormat: input.dateFormat } : {}),
      ...('taxId' in input ? { taxId: input.taxId } : {}),
    });

    const saved = await this.tenants.update(tenant);

    // Invalidate the branding cache so the next read is fresh (Requirement 11.4).
    // The last-known-good snapshot used for graceful degradation (task 41.4) is
    // invalidated too, so a subsequent transient read failure can never serve
    // pre-update branding.
    await this.cache.del(brandingCacheKey(input.id));
    await this.cache.del(brandingStaleCacheKey(input.id));

    return toTenantOutput(saved);
  }
}
