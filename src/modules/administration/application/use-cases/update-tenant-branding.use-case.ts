import { NotFoundError } from '@domain/errors/index.js';
import type { ITenantRepository } from '../../domain/repositories/tenant-repository.js';
import {
  toTenantOutput,
  type TenantOutput,
  type UpdateTenantBrandingInputDto,
} from '../dto/administration-dtos.js';

/**
 * Updates a tenant's branding/customization configuration (Requirement 11.1):
 * commercial name, logo, primary/secondary colours, theme, tax data and the
 * localization quartet (language/timezone/currency/date format).
 *
 * Only the fields provided on the input are changed; `null` clears an optional
 * field. Each visual field is re-validated by the {@link Tenant} entity's value
 * objects (hex colour format, `light`/`dark` theme, non-empty locales).
 *
 * The `logo` field is a plain asset URL here — uploading the asset to secure
 * cloud storage with tenant isolation is task 27.3; this use case only persists
 * the reference.
 *
 * @throws {NotFoundError} when the tenant does not exist (or is soft-deleted).
 * @throws {ValidationError} when a provided branding field is malformed.
 */
export class UpdateTenantBrandingUseCase {
  constructor(private readonly tenants: ITenantRepository) {}

  async execute(input: UpdateTenantBrandingInputDto): Promise<TenantOutput> {
    const tenant = await this.tenants.findById(input.id);
    if (tenant === null) {
      throw NotFoundError.forEntity('Tenant', input.id);
    }

    tenant.updateBranding({
      ...('name' in input ? { name: input.name } : {}),
      ...('logo' in input ? { logo: input.logo } : {}),
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
    return toTenantOutput(saved);
  }
}
