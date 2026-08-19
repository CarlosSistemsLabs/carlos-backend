import { Role } from '../../domain/entities/role.js';
import { Permission } from '../../domain/value-objects/permission.js';
import { SYSTEM_ROLE_DEFINITIONS } from '../../domain/constants/permission-catalog.js';
import type { IRoleRepository } from '../../domain/repositories/role-repository.js';
import {
  toRoleOutput,
  type RoleOutput,
  type SeedSystemRolesInput,
} from '../dto/authorization-dtos.js';

/**
 * Seeds the default system roles (Admin, Manager, User) for a tenant
 * (Requirement 28.5 — seed initial roles/permissions for a new tenant).
 *
 * Invoked during tenant provisioning (task 27.1) and by the development seed
 * scripts. It is **idempotent**: a system role that already exists for the
 * tenant is left untouched and returned as-is, so re-provisioning never raises
 * a conflict. The permission matrix is the documented constant
 * {@link SYSTEM_ROLE_DEFINITIONS}.
 */
export class SeedSystemRolesUseCase {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: SeedSystemRolesInput): Promise<RoleOutput[]> {
    const results: RoleOutput[] = [];

    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      const existing = await this.roles.findByName(input.tenantId, definition.name);
      if (existing !== null) {
        results.push(toRoleOutput(existing));
        continue;
      }

      const role = Role.create({
        tenantId: input.tenantId,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        permissions: definition.permissions.map((permission) =>
          Permission.fromDescriptor(permission),
        ),
      });

      const saved = await this.roles.create(role);
      results.push(toRoleOutput(saved));
    }

    return results;
  }
}
