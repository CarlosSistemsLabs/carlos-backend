import type { UUID } from '@shared/types/index.js';
import type { Tenant } from '../entities/tenant.js';

/**
 * Persistence abstraction for the {@link Tenant} aggregate root.
 *
 * The tenant is the multi-tenancy root and is NOT scoped by a `tenantId`, so
 * the concrete implementation is bound to the UNEXTENDED `systemPrisma` client
 * (the tenant auto-filter has no tenant to inject during provisioning and would
 * otherwise break creating/reading a tenant). The domain depends only on this
 * port (Clean Architecture, Requirement 3.2); it is Prisma-free.
 */
export interface ITenantRepository {
  /** Finds a tenant by id (excluding soft-deleted), or `null` when not found. */
  findById(id: UUID): Promise<Tenant | null>;

  /**
   * Finds a tenant by its unique slug (excluding soft-deleted), or `null`.
   * Backs the slug-uniqueness check performed during provisioning.
   */
  findBySlug(slug: string): Promise<Tenant | null>;

  /** Persists a new tenant row. */
  create(tenant: Tenant): Promise<Tenant>;

  /** Persists changes to an existing tenant's mutable (branding) fields. */
  update(tenant: Tenant): Promise<Tenant>;

  /**
   * Soft-deletes a tenant by stamping `deletedAt`. Also used as the
   * provisioning compensation step when post-create seeding fails, so a
   * half-provisioned tenant is retired and its slug is freed for retry.
   */
  softDelete(id: UUID): Promise<void>;
}
