/**
 * Public façade for the Administration module.
 *
 * This module owns tenant lifecycle + customization: provisioning a new tenant
 * (creating the tenant root and seeding its default roles/permissions and
 * configurations), updating branding, and managing per-tenant key/value
 * configuration (Requirements 1.4, 11.1, 28.5). Other modules and the
 * composition root MUST consume these capabilities through this barrel rather
 * than reaching into internals (module boundaries, Façade pattern).
 *
 * HTTP routes / user + role management endpoints (task 27.2) and branding asset
 * upload to cloud storage (task 27.3) are added later; this task delivers the
 * domain, use cases, configuration management and infrastructure.
 */

// Use cases (application entry points)
export { CreateTenantUseCase } from './application/use-cases/create-tenant.use-case.js';
export { UpdateTenantBrandingUseCase } from './application/use-cases/update-tenant-branding.use-case.js';
export { UpdateBrandingUseCase } from './application/use-cases/update-branding.use-case.js';
export {
  GetBrandingUseCase,
  DEFAULT_BRANDING_CACHE_TTL_SECONDS,
} from './application/use-cases/get-branding.use-case.js';
export { SetConfigurationUseCase } from './application/use-cases/set-configuration.use-case.js';
export { GetConfigurationUseCase } from './application/use-cases/get-configuration.use-case.js';
export { ListConfigurationsUseCase } from './application/use-cases/list-configurations.use-case.js';
export { AssignRoleToUserUseCase } from './application/use-cases/assign-role-to-user.use-case.js';
export { GetAuditLogsUseCase } from './application/use-cases/get-audit-logs.use-case.js';

// DTOs + mappers + default seed data
export {
  DEFAULT_TENANT_CONFIGURATIONS,
  toTenantOutput,
  type CreateTenantInputDto,
  type UpdateTenantBrandingInputDto,
  type TenantOutput,
  type SetConfigurationInputDto,
  type GetConfigurationInputDto,
  type ListConfigurationsInputDto,
  type ConfigurationOutput,
  type AssignRoleToUserInputDto,
  type GetAuditLogsInputDto,
  type AuditLogOutput,
  brandingCacheKey,
  type UpdateBrandingInputDto,
  type GetBrandingInputDto,
} from './application/dto/administration-dtos.js';

// Domain entity
export {
  Tenant,
  TENANT_DEFAULTS,
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
  type TenantProps,
  type CreateTenantInput,
  type UpdateBrandingInput,
} from './domain/entities/tenant.js';

// Value objects
export { BrandColor } from './domain/value-objects/brand-color.js';
export { Theme, THEMES, type ThemeName } from './domain/value-objects/theme.js';

// Repository ports (implemented by infrastructure)
export type { ITenantRepository } from './domain/repositories/tenant-repository.js';
export type {
  IConfigurationRepository,
  ConfigurationEntry,
  JsonValue,
} from './domain/repositories/configuration-repository.js';
export type { ITenantRoleSeeder } from './domain/repositories/tenant-role-seeder.js';
export type {
  IAuditLogRepository,
  AuditLogRecord,
  AuditLogFilters,
  AuditLogQuery,
} from './domain/repositories/audit-log-repository.js';

// Infrastructure implementations
export {
  PrismaTenantRepository,
  type TenantPrismaClient,
  type TenantModelDelegate,
  type TenantRow,
} from './infrastructure/prisma-tenant-repository.js';
export {
  PrismaConfigurationRepository,
  type ConfigurationPrismaClient,
  type ConfigurationModelDelegate,
  type ConfigurationRow,
} from './infrastructure/prisma-configuration-repository.js';
export {
  PrismaAuditLogRepository,
  type AuditLogPrismaClient,
  type AuditLogModelDelegate,
  type AuditLogRow,
} from './infrastructure/prisma-audit-log-repository.js';

// Presentation (HTTP routes) — task 27.2
export {
  registerAdminRoutes,
  adminRoutesPlugin,
  buildAdminUseCases,
  type AdminRoutesOptions,
} from './presentation/admin.routes.js';

// Presentation (HTTP routes) — task 27.3 (branding)
export {
  registerBrandingRoutes,
  brandingRoutesPlugin,
  type BrandingRoutesOptions,
} from './presentation/branding.routes.js';
