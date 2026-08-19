import type { Nullable, UUID } from '@shared/types/index.js';
import type { LogoUpload } from '@application/ports/storage.js';
import type { Tenant } from '../../domain/entities/tenant.js';
import type {
  ConfigurationEntry,
  JsonValue,
} from '../../domain/repositories/configuration-repository.js';
import type { AuditLogRecord } from '../../domain/repositories/audit-log-repository.js';

/** Input for {@link CreateTenantUseCase}. */
export interface CreateTenantInputDto {
  /** Commercial name shown to users. */
  name: string;
  /** URL-safe unique identifier (validated + normalised to lower-case). */
  slug: string;
  logo?: Nullable<string>;
  primaryColor?: Nullable<string>;
  secondaryColor?: Nullable<string>;
  theme?: string;
  language?: string;
  timezone?: string;
  currency?: string;
  dateFormat?: string;
  taxId?: Nullable<string>;
}

/**
 * Input for {@link UpdateTenantBrandingUseCase}. Every branding field is
 * optional; only provided fields are changed. Use `null` to clear an optional
 * field (`logo`, `primaryColor`, `secondaryColor`, `taxId`). The immutable
 * `slug` is intentionally not accepted.
 */
export interface UpdateTenantBrandingInputDto {
  id: UUID;
  name?: string;
  logo?: Nullable<string>;
  primaryColor?: Nullable<string>;
  secondaryColor?: Nullable<string>;
  theme?: string;
  language?: string;
  timezone?: string;
  currency?: string;
  dateFormat?: string;
  taxId?: Nullable<string>;
}

/**
 * Input for {@link UpdateBrandingUseCase} (task 27.3). Extends the plain
 * branding fields with cloud-storage integration: an OPTIONAL `logoFile` is
 * uploaded via the storage port and its returned URL is set as the tenant
 * `logo`. When no `logoFile` is provided, the branding is updated from the
 * fields alone (and `logo` may still be set/cleared as a plain URL, matching
 * {@link UpdateTenantBrandingInputDto}). Only provided fields are changed; pass
 * `null` to clear an optional field.
 */
export interface UpdateBrandingInputDto extends UpdateTenantBrandingInputDto {
  /** Raw logo asset to upload; when present it overrides any `logo` URL field. */
  logoFile?: LogoUpload;
}

/** Input for {@link GetBrandingUseCase} — reads a single tenant's branding. */
export interface GetBrandingInputDto {
  tenantId: UUID;
}

/**
 * Builds the {@link ICache} key under which a tenant's branding projection is
 * cached (`branding:<tenantId>`). Centralised so the read (populate) and write
 * (invalidate) paths always agree on the key.
 */
export function brandingCacheKey(tenantId: UUID): string {
  return `branding:${tenantId}`;
}

/**
 * Builds the {@link ICache} key under which a tenant's LAST-KNOWN-GOOD branding
 * projection is retained for graceful degradation (`branding:stale:<tenantId>`,
 * task 41.4, Requirement 27.7).
 *
 * Distinct from {@link brandingCacheKey}: the fresh cache-aside entry expires on
 * its TTL and is invalidated on write, whereas THIS snapshot is kept as the
 * value {@link GetBrandingUseCase} serves if a live tenant read fails
 * transiently — branding is a non-critical, presentational read, so serving the
 * last-known logo/colours beats erroring the UI. It is refreshed on every
 * successful read and invalidated alongside the fresh key on every branding
 * write, so it can never serve pre-update branding after a successful change.
 * Tenant-scoped like the fresh key, so one tenant never sees another's snapshot.
 */
export function brandingStaleCacheKey(tenantId: UUID): string {
  return `branding:stale:${tenantId}`;
}

/**
 * Builds the {@link ICache} key under which a tenant's FULL configuration list
 * is cached (`tenant-config:<tenantId>`).
 *
 * Used by {@link ListConfigurationsUseCase} (populate) and invalidated by
 * {@link SetConfigurationUseCase} (task 39.4, Requirement 26.1). Kept identical
 * to `CacheKeys.tenantConfigurations` in the infrastructure cache-keys helper
 * (and to the cache warmer's key) so warming, reads and invalidation all target
 * the exact same entry.
 */
export function tenantConfigurationsCacheKey(tenantId: UUID): string {
  return `tenant-config:${tenantId}`;
}

/**
 * Builds the {@link ICache} key under which a SINGLE tenant configuration entry
 * is cached (`tenant-config:<tenantId>:<key>`).
 *
 * Used by {@link GetConfigurationUseCase} (populate) and invalidated by
 * {@link SetConfigurationUseCase} (task 39.4, Requirement 26.1). Kept identical
 * to `CacheKeys.tenantConfiguration` in the infrastructure cache-keys helper.
 */
export function tenantConfigurationCacheKey(tenantId: UUID, key: string): string {
  return `tenant-config:${tenantId}:${key}`;
}

/** Public projection of a {@link Tenant}. Value objects are flattened to strings. */
export interface TenantOutput {
  id: UUID;
  name: string;
  slug: string;
  logo: Nullable<string>;
  primaryColor: Nullable<string>;
  secondaryColor: Nullable<string>;
  theme: string;
  language: string;
  timezone: string;
  currency: string;
  dateFormat: string;
  taxId: Nullable<string>;
}

/** Input for {@link SetConfigurationUseCase}. */
export interface SetConfigurationInputDto {
  tenantId: UUID;
  key: string;
  value: JsonValue;
}

/** Input for {@link GetConfigurationUseCase}. */
export interface GetConfigurationInputDto {
  tenantId: UUID;
  key: string;
}

/** Input for {@link ListConfigurationsUseCase}. */
export interface ListConfigurationsInputDto {
  tenantId: UUID;
}

/** Public projection of a configuration entry (identical shape, re-exported). */
export type ConfigurationOutput = ConfigurationEntry;

/**
 * Default configuration entries seeded for every new tenant (Requirement 28.5 —
 * "seed initial data: roles, permissions, default configurations"). Kept as a
 * documented, framework-agnostic constant so provisioning and any dev seed
 * scripts share one source of truth. Values are sensible platform defaults; a
 * tenant admin can override any of them later through the configuration API.
 */
export const DEFAULT_TENANT_CONFIGURATIONS: readonly ConfigurationEntry[] = [
  // Onboarding wizard has not been completed yet for a brand-new tenant.
  { key: 'onboarding.completed', value: false },
  // Default VAT/IVA rate for Argentina (percentage); overridable per tenant.
  { key: 'sales.defaultTaxRate', value: 21 },
  // Sales documents start numbering from 1.
  { key: 'sales.invoiceStartNumber', value: 1 },
  // Transactional email notifications are on by default.
  { key: 'notifications.email.enabled', value: true },
];

/** Maps a {@link Tenant} aggregate to its public projection. */
export function toTenantOutput(tenant: Tenant): TenantOutput {
  return {
    id: tenant.id,
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

// ---------------------------------------------------------------------------
// Admin user + audit-log management (task 27.2)
// ---------------------------------------------------------------------------

/**
 * Input for {@link AssignRoleToUserUseCase}. The `tenantId` is always taken
 * from the authenticated admin's token, never the client body, so an admin can
 * only reassign roles for users within their own tenant.
 */
export interface AssignRoleToUserInputDto {
  tenantId: UUID;
  userId: UUID;
  roleId: UUID;
}

/** Input for {@link GetAuditLogsUseCase} (read-only, tenant-scoped). */
export interface GetAuditLogsInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  entityType?: string;
  entityId?: string;
  userId?: UUID;
  action?: string;
  /** Inclusive lower bound on the record timestamp. */
  from?: Date;
  /** Inclusive upper bound on the record timestamp. */
  to?: Date;
}

/**
 * Public projection of an audit-log record. Identical to the domain
 * {@link AuditLogRecord} read model, re-exported so the presentation layer does
 * not import the repository port directly.
 */
export type AuditLogOutput = AuditLogRecord;
