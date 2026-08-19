import type { UUID } from '@shared/types/index.js';

/**
 * Output port through which tenant provisioning seeds the default system roles
 * (Admin/Manager/User) and their permission matrix for a freshly created tenant
 * (Requirement 28.5).
 *
 * This is intentionally a thin, result-agnostic port: the Administration module
 * depends only on the *capability* of seeding roles for a tenant, not on the
 * Authorization module's concrete types. The composition root satisfies it by
 * wiring the Authorization module's `SeedSystemRolesUseCase` (which structurally
 * matches this signature), keeping the two modules decoupled while reusing the
 * existing, idempotent seeding logic.
 */
export interface ITenantRoleSeeder {
  /** Seeds the default system roles/permissions for the given tenant. */
  execute(input: { tenantId: UUID }): Promise<unknown>;
}
