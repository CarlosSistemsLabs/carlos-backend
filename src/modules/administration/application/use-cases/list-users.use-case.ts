import type { PaginatedResult } from '@shared/types/index.js';
import { toUserOutput, type IUserRepository, type UserOutput } from '@modules/auth/index.js';
import type { ListUsersInputDto } from '../dto/administration-dtos.js';

/** Default page size when the caller does not specify one. */
const DEFAULT_PAGE_SIZE = 20;
/** Default (first) page when the caller does not specify one. */
const DEFAULT_PAGE = 1;

/**
 * Lists a tenant's users with optional filtering + pagination (task 46.7 —
 * admin "user management", Requirement 18.1 administration).
 *
 * Read-only. The tenant is supplied by the presentation layer from the
 * authenticated admin's token (never the client), so a caller can only ever
 * list their own tenant's users. Each user is returned through the safe
 * {@link UserOutput} projection (never the password hash), consumed through the
 * Auth module's public facade so no internals are reached into.
 */
export class ListUsersUseCase {
  constructor(private readonly users: IUserRepository) {}

  async execute(input: ListUsersInputDto): Promise<PaginatedResult<UserOutput>> {
    const page = input.page ?? DEFAULT_PAGE;
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

    const result = await this.users.listByTenant(input.tenantId, {
      page,
      pageSize,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.search !== undefined ? { search: input.search } : {}),
    });

    return {
      items: result.items.map(toUserOutput),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    };
  }
}
