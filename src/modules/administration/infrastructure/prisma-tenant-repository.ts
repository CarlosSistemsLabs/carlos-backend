import type { UUID } from '@shared/types/index.js';
import { Tenant } from '../domain/entities/tenant.js';
import { BrandColor } from '../domain/value-objects/brand-color.js';
import { Theme } from '../domain/value-objects/theme.js';
import type { ITenantRepository } from '../domain/repositories/tenant-repository.js';

/**
 * Persistence row shape for the `Tenant` model. A structural subset of the
 * generated Prisma type so the value-object ⇄ column mapping stays explicit and
 * the repository remains trivially testable with a fake delegate.
 */
export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  theme: string;
  language: string;
  timezone: string;
  currency: string;
  dateFormat: string;
  taxId: string | null;
}

/** Minimal `tenant` delegate surface used by {@link PrismaTenantRepository}. */
export interface TenantModelDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<TenantRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<TenantRow>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<TenantRow>;
}

/** A Prisma-like client exposing (at least) the `tenant` delegate. */
export interface TenantPrismaClient {
  tenant: TenantModelDelegate;
}

/**
 * Prisma-backed {@link ITenantRepository}.
 *
 * **Client choice:** bound (in the composition root) to the UNEXTENDED
 * `systemPrisma` client. The `Tenant` model is the multi-tenancy ROOT and is not
 * itself scoped by a `tenantId`, so the tenant auto-filter would have no tenant
 * to inject during provisioning (and it is not in {@link isTenantScopedModel}
 * anyway). Reads exclude soft-deleted rows (`deletedAt != null`) so a retired
 * tenant's slug is free for re-use (Requirement 9.4).
 */
export class PrismaTenantRepository implements ITenantRepository {
  constructor(private readonly prisma: TenantPrismaClient) {}

  async findById(id: UUID): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
    return row === null ? null : PrismaTenantRepository.toDomain(row);
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findFirst({ where: { slug, deletedAt: null } });
    return row === null ? null : PrismaTenantRepository.toDomain(row);
  }

  async create(tenant: Tenant): Promise<Tenant> {
    const row = await this.prisma.tenant.create({
      data: { id: tenant.id, ...PrismaTenantRepository.toPersistence(tenant) },
    });
    return PrismaTenantRepository.toDomain(row);
  }

  async update(tenant: Tenant): Promise<Tenant> {
    const row = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: PrismaTenantRepository.toPersistence(tenant),
    });
    return PrismaTenantRepository.toDomain(row);
  }

  async softDelete(id: UUID): Promise<void> {
    await this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Maps a persistence row to the {@link Tenant} aggregate. */
  private static toDomain(row: TenantRow): Tenant {
    return Tenant.reconstitute(row.id, {
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      primaryColor: row.primaryColor === null ? null : BrandColor.create(row.primaryColor),
      secondaryColor: row.secondaryColor === null ? null : BrandColor.create(row.secondaryColor),
      theme: Theme.create(row.theme),
      language: row.language,
      timezone: row.timezone,
      currency: row.currency,
      dateFormat: row.dateFormat,
      taxId: row.taxId,
    });
  }

  /** Maps a {@link Tenant} aggregate to a persistence payload (slug is immutable). */
  private static toPersistence(tenant: Tenant): Record<string, unknown> {
    return {
      name: tenant.name,
      slug: tenant.slug,
      logo: tenant.logo,
      primaryColor: tenant.primaryColor === null ? null : tenant.primaryColor.value,
      secondaryColor: tenant.secondaryColor === null ? null : tenant.secondaryColor.value,
      theme: tenant.theme.value,
      language: tenant.language,
      timezone: tenant.timezone,
      currency: tenant.currency,
      dateFormat: tenant.dateFormat,
      taxId: tenant.taxId,
    };
  }
}
