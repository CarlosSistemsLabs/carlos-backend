import type { UUID } from '@shared/types/index.js';
import type { AuthUser } from '../entities/auth-user.js';

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

  /** Persists a newly created user and returns the stored representation. */
  create(user: AuthUser): Promise<AuthUser>;

  /** Persists changes to an existing user and returns the stored result. */
  update(user: AuthUser): Promise<AuthUser>;
}
