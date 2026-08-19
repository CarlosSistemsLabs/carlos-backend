import { NotFoundError } from '@domain/errors/index.js';
import { Permission } from '../../domain/value-objects/permission.js';
import type { IRoleRepository } from '../../domain/repositories/role-repository.js';
import {
  toRoleOutput,
  type RoleOutput,
  type UpdateRolePermissionsInput,
} from '../dto/authorization-dtos.js';

/**
 * Replaces a role's permission set with a new one (task 27.2 — admin "update
 * role permissions", Requirement 18.4).
 *
 * The role is resolved tenant-scoped: a role that does not exist OR belongs to
 * another tenant surfaces as {@link NotFoundError} (404) so the endpoint never
 * leaks the existence of another tenant's roles. System roles (Admin, Manager,
 * User) are protected — attempting to modify their permissions raises the
 * domain {@link SystemRoleModificationError} (a `BusinessRuleError`, mapped to
 * 422) via {@link Role.replacePermissions}. The supplied permissions fully
 * replace the current grants (not an additive merge).
 */
export class UpdateRolePermissionsUseCase {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: UpdateRolePermissionsInput): Promise<RoleOutput> {
    const role = await this.roles.findById(input.roleId);
    if (role === null || role.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Role', input.roleId);
    }

    const permissions = input.permissions.map((permission) =>
      Permission.create(permission.module, permission.screen, permission.action),
    );

    // Enforces the system-role guard in the domain (throws for system roles).
    role.replacePermissions(permissions);

    const saved = await this.roles.replacePermissions(role, permissions);
    return toRoleOutput(saved);
  }
}
