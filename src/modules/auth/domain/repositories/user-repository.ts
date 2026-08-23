import type { PaginatedResult, UUID } from '@shared/types/index.js';
import type { AuthUser } from '../entities/auth-user.js';

/**
 * Filters + pagination for a tenant-scoped user listing (task 46.7).
 *
 * `page`/`pageSize` are required (the caller resolves defaults); `isActive` and
 * `search` are optional. `search` matches (case-insensitively) against the
 * user's email, first name or last name.
 */
export interface ListUsersQuery {
  page: number;
  pageSize: number;
  isActive?: boolean;
  search?: string;
}

/**
 * Persistence abstraction for {@link AuthUser} aggregates.
 *
 * Reads are tenant-scoped where uniqueness is tenant-scoped (email is unique
 * per tenant — see the `@@unique([tenantId, email])` constraint). The concrete
 * implementation lives in the infrastructure layer.
 */
export interface IUserRepository {
  /**
   * Finds an active or inactive user by email within a tenant, or `null` when
   * no such user exists.
   */
  findByEmail(tenantId: UUID, email: string): Promise<AuthUser | null>;

  /** Finds a user by global id, or `null` when not found. */
  findById(id: UUID): Promise<AuthUser | null>;

  /**
   * Lists a tenant's users (newest-relevant ordering, ordered by email) with
   * optional filtering + pagination. Tenant-scoped: only the given tenant's
   * users are ever returned (Requirement 1.5).
   */
  listByTenant(tenantId: UUID, query: ListUsersQuery): Promise<PaginatedResult<AuthUser>>;

  /** Persists a newly created user and returns the stored representation. */
  create(user: AuthUser): Promise<AuthUser>;

  /** Persists changes to an existing user and returns the stored result. */
  update(user: AuthUser): Promise<AuthUser>;
}
