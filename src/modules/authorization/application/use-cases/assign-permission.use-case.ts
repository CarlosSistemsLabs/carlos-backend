import { NotFoundError, ValidationError } from '@domain/errors/index.js';
import { Permission } from '../../domain/value-objects/permission.js';
import type { IRoleRepository } from '../../domain/repositories/role-repository.js';
import {
  toRoleOutput,
  type AssignPermissionInput,
  type RoleOutput,
} from '../dto/authorization-dtos.js';

/**
 * Attaches one or more permissions to an existing role (Requirement 8.4).
 *
 * Idempotent: permissions already held by the role are silently skipped rather
 * than raising a conflict, matching the `@@unique([roleId, module, screen,
 * action])` constraint. Re-running with the same input yields the same role
 * state.
 */
export class AssignPermissionUseCase {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: AssignPermissionInput): Promise<RoleOutput> {
    if (input.permissions.length === 0) {
      throw new ValidationError('At least one permission is required', { field: 'permissions' });
    }

    const role = await this.roles.findById(input.roleId);
    if (role === null) {
      throw NotFoundError.forEntity('Role', input.roleId);
    }

    const permissions = input.permissions.map((permission) =>
      Permission.create(permission.module, permission.screen, permission.action),
    );

    // Reflect the grants on the aggregate (idempotent in-memory) and persist
    // them (idempotent at the database via skip-duplicates).
    for (const permission of permissions) {
      role.addPermission(permission);
    }

    const saved = await this.roles.addPermissions(role, permissions);
    return toRoleOutput(saved);
  }
}
