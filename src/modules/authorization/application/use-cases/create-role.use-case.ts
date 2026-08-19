import { ConflictError, ValidationError } from '@domain/errors/index.js';
import { Role } from '../../domain/entities/role.js';
import { Permission } from '../../domain/value-objects/permission.js';
import type { IRoleRepository } from '../../domain/repositories/role-repository.js';
import { toRoleOutput, type CreateRoleInput, type RoleOutput } from '../dto/authorization-dtos.js';

/**
 * Creates a new role within a tenant (Requirement 8.4).
 *
 * Enforces per-tenant name uniqueness (`@@unique([tenantId, name])` →
 * {@link ConflictError}), validates the supplied permissions, and persists the
 * role together with its initial permission set.
 */
export class CreateRoleUseCase {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: CreateRoleInput): Promise<RoleOutput> {
    const name = input.name?.trim();
    if (name === undefined || name.length === 0) {
      throw new ValidationError('Role name is required', { field: 'name' });
    }

    const existing = await this.roles.findByName(input.tenantId, name);
    if (existing !== null) {
      throw new ConflictError('A role with this name already exists', { field: 'name' });
    }

    const permissions = (input.permissions ?? []).map((permission) =>
      Permission.create(permission.module, permission.screen, permission.action),
    );

    const role = Role.create({
      tenantId: input.tenantId,
      name,
      description: input.description ?? null,
      isSystem: input.isSystem ?? false,
      permissions,
    });

    const saved = await this.roles.create(role);
    return toRoleOutput(saved);
  }
}
