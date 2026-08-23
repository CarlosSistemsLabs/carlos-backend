import { NotFoundError } from '@domain/errors/index.js';
import { toRoleOutput, type IRoleRepository, type RoleOutput } from '@modules/authorization/index.js';
import type { GetRoleInputDto } from '../dto/administration-dtos.js';

/**
 * Reads a single role with its permission set (task 46.7 — admin "role
 * management", Requirement 18.1 administration).
 *
 * Read-only. The role is resolved tenant-scoped: a role that does not exist OR
 * belongs to another tenant surfaces as {@link NotFoundError} (404), so the
 * endpoint never leaks cross-tenant existence (mirroring
 * {@link AssignRoleToUserUseCase}). The tenant comes from the authenticated
 * admin's token, never the client.
 */
export class GetRoleUseCase {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: GetRoleInputDto): Promise<RoleOutput> {
    const role = await this.roles.findById(input.roleId);
    if (role === null || role.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Role', input.roleId);
    }
    return toRoleOutput(role);
  }
}
