import { ConflictError } from '@domain/errors/index.js';
import { Tenant } from '../../domain/entities/tenant.js';
import type { ITenantRepository } from '../../domain/repositories/tenant-repository.js';
import type { IConfigurationRepository } from '../../domain/repositories/configuration-repository.js';
import type { ITenantRoleSeeder } from '../../domain/repositories/tenant-role-seeder.js';
import {
  DEFAULT_TENANT_CONFIGURATIONS,
  toTenantOutput,
  type CreateTenantInputDto,
  type TenantOutput,
} from '../dto/administration-dtos.js';

/**
 * Provisions a brand-new tenant and its isolated starting structures
 * (Requirements 1.4, 28.5).
 *
 * ## Provisioning steps
 * 1. Build + validate the {@link Tenant} (branding invariants) and reject a
 *    duplicate slug with a {@link ConflictError} (the DB `@@unique(slug)` is the
 *    backstop; the explicit check yields a clean 409).
 * 2. Persist the tenant row (via the `systemPrisma`-bound repository — the
 *    tenant is the multi-tenancy root and is not itself tenant-scoped).
 * 3. Seed the default system roles + permission matrix (Admin/Manager/User)
 *    through {@link ITenantRoleSeeder} — the reused, idempotent
 *    `SeedSystemRolesUseCase`.
 * 4. Seed the default {@link DEFAULT_TENANT_CONFIGURATIONS} (upsert semantics).
 *
 * ## Atomicity / compensation
 * The tenant row (system-scoped) and the roles/configurations (tenant-scoped)
 * are written through different clients (`systemPrisma` vs `tenantPrisma`), so a
 * single interactive transaction spanning both is not used here. Instead, steps
 * run in dependency order and, if any post-create seeding step fails, the
 * half-provisioned tenant is **compensated** by a soft-delete so it is retired
 * and its slug is freed for a clean retry. Because role seeding is idempotent
 * and configuration seeding uses upsert, re-running provisioning is safe.
 *
 * Provisioning is a small, bounded set of inserts (one tenant, three roles with
 * their permissions, a handful of configuration rows), comfortably within the
 * 5-second target (Requirement 1.4).
 *
 * First-admin-user creation is intentionally **out of scope** for this use case:
 * a tenant's initial user is created through the auth module's registration flow
 * (task 27.2), keeping provisioning free of password-hashing/auth coupling.
 */
export class CreateTenantUseCase {
  constructor(
    private readonly tenants: ITenantRepository,
    private readonly roleSeeder: ITenantRoleSeeder,
    private readonly configurations: IConfigurationRepository,
  ) {}

  async execute(input: CreateTenantInputDto): Promise<TenantOutput> {
    // Validates branding invariants and normalises the slug (lower-cased).
    const tenant = Tenant.create({
      name: input.name,
      slug: input.slug,
      logo: input.logo ?? null,
      primaryColor: input.primaryColor ?? null,
      secondaryColor: input.secondaryColor ?? null,
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.dateFormat !== undefined ? { dateFormat: input.dateFormat } : {}),
      taxId: input.taxId ?? null,
    });

    const existing = await this.tenants.findBySlug(tenant.slug);
    if (existing !== null) {
      throw new ConflictError('A tenant with this slug already exists', {
        field: 'slug',
        slug: tenant.slug,
      });
    }

    const created = await this.tenants.create(tenant);

    try {
      // Seed default roles/permissions (idempotent) then default configuration.
      await this.roleSeeder.execute({ tenantId: created.id });
      for (const entry of DEFAULT_TENANT_CONFIGURATIONS) {
        await this.configurations.set(created.id, entry.key, entry.value);
      }
    } catch (error) {
      // Compensation: retire the half-provisioned tenant so the slug is freed
      // and no partially-seeded tenant is left usable. Best-effort — the
      // original error is always the one surfaced to the caller.
      await this.tenants.softDelete(created.id).catch(() => undefined);
      throw error;
    }

    return toTenantOutput(created);
  }
}
