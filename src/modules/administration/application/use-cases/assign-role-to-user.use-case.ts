import { NotFoundError } from '@domain/errors/index.js';
import { toUserOutput, type IUserRepository, type UserOutput } from '@modules/auth/index.js';
import type { IRoleRepository } from '@modules/authorization/index.js';
import type { AssignRoleToUserInputDto } from '../dto/administration-dtos.js';

/**
 * Assigns an existing role to a user within the caller's tenant (task 27.2 —
 * admin "assign role to user", Requirement 18.1 administration).
 *
 * Both the user and the role are resolved tenant-scoped: a user or role that
 * does not exist OR belongs to another tenant surfaces as {@link NotFoundError}
 * (404), so the endpoint never leaks cross-tenant existence and an admin can
 * only operate within their own tenant. On success the user's role association
 * is updated and the safe {@link UserOutput} projection (never the password
 * hash) is returned.
 *
 * This orchestration deliberately lives in the Administration module: it spans
 * the Auth ({@link IUserRepository}) and Authorization ({@link IRoleRepository})
 * modules, both consumed through their public facades so no module internals
 * are reached into.
 */
export class AssignRoleToUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly roles: IRoleRepository,
  ) {}

  async execute(input: AssignRoleToUserInputDto): Promise<UserOutput> {
    const user = await this.users.findById(input.userId);
    if (user === null || user.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('User', input.userId);
    }

    const role = await this.roles.findById(input.roleId);
    if (role === null || role.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Role', input.roleId);
    }

    user.assignRole(input.roleId);
    const saved = await this.users.update(user);
    return toUserOutput(saved);
  }
}
