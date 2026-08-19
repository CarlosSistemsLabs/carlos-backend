import type { Nullable, UUID } from '@shared/types/index.js';
import type { Role } from '../../domain/entities/role.js';
import type { PermissionDescriptor } from '../../domain/value-objects/permission.js';

/** A single permission grant as accepted/returned by the application layer. */
export type PermissionInput = PermissionDescriptor;

/** Input for {@link CreateRoleUseCase}. */
export interface CreateRoleInput {
  tenantId: UUID;
  name: string;
  description?: Nullable<string>;
  /** Marks the role as platform-managed. Defaults to `false`. */
  isSystem?: boolean;
  /** Optional initial permissions to grant. */
  permissions?: readonly PermissionInput[];
}

/** Input for {@link AssignPermissionUseCase}. */
export interface AssignPermissionInput {
  roleId: UUID;
  permissions: readonly PermissionInput[];
}

/** Input for {@link UpdateRolePermissionsUseCase}. */
export interface UpdateRolePermissionsInput {
  tenantId: UUID;
  roleId: UUID;
  /** The complete permission set that should replace the role's current grants. */
  permissions: readonly PermissionInput[];
}

/** Input for {@link SeedSystemRolesUseCase}. */
export interface SeedSystemRolesInput {
  tenantId: UUID;
}

/** Public projection of a {@link Role}. */
export interface RoleOutput {
  id: UUID;
  tenantId: UUID;
  name: string;
  description: Nullable<string>;
  isSystem: boolean;
  permissions: PermissionDescriptor[];
}

/** Maps a {@link Role} aggregate to its public projection. */
export function toRoleOutput(role: Role): RoleOutput {
  return {
    id: role.id,
    tenantId: role.tenantId,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map((permission) => permission.toDescriptor()),
  };
}
