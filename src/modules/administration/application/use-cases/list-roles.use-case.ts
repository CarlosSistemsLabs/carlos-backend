import { toRoleOutput, type IRoleRepository, type RoleOutput } from '@modules/authorization/index.js';
import type { ListRolesInputDto } from '../dto/administration-dtos.js';

/**
 * Lists all roles for a tenant, each with its permission set (task 46.7 — admin
 * "role management", Requirement 18.1 administration).
 *
 * Read-only. The tenant is supplied by the presentation layer from the
 * authenticated admin's token (never the client), so a caller can only ever
 * list their own tenant's roles. Roles are returned through the Authorization
 * module's public facade ({@link toRoleOutput}) so no internals are reached
 * into. Not paginated: a tenant's role set is small and bounded, and the UI
 * needs the whole set to populate role pickers.
 */
export class ListRolesUseCase {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: ListRolesInputDto): Promise<RoleOutput[]> {
    const roles = await this.roles.findByTenant(input.tenantId);
    return roles.map(toRoleOutput);
  }
}
