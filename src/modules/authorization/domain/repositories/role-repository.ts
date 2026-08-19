import type { UUID } from '@shared/types/index.js';
import type { Role } from '../entities/role.js';
import type { Permission } from '../value-objects/permission.js';

/**
 * Persistence abstraction for {@link Role} aggregates and their permissions.
 *
 * Roles are tenant-scoped (`@@unique([tenantId, name])`), so reads that resolve
 * a role by name take the tenant explicitly. The concrete implementation lives
 * in the infrastructure layer; the domain depends only on this port
 * (Clean Architecture, Requirement 3.2).
 */
export interface IRoleRepository {
  /** Finds a role (with its permissions) by id, or `null` when not found. */
  findById(id: UUID): Promise<Role | null>;

  /** Returns all roles for a tenant, each with its permissions. */
  findByTenant(tenantId: UUID): Promise<Role[]>;

  /** Finds a role by its tenant-unique name, or `null` when not found. */
  findByName(tenantId: UUID, name: string): Promise<Role | null>;

  /** Persists a new role together with its initial permissions. */
  create(role: Role): Promise<Role>;

  /** Persists changes to a role's mutable fields (name, description). */
  update(role: Role): Promise<Role>;

  /**
   * Attaches the given permissions to an existing role. Idempotent on the
   * `@@unique([roleId, module, screen, action])` constraint — already-present
   * permissions are skipped rather than raising a conflict. Returns the role
   * with its full, current permission set.
   */
  addPermissions(role: Role, permissions: readonly Permission[]): Promise<Role>;

  /**
   * Replaces a role's entire permission set with the supplied permissions
   * (task 27.2 — admin "update role permissions"). Existing permissions are
   * removed and the new set is inserted, so this is NOT idempotent-additive
   * like {@link addPermissions}. Returns the role with its refreshed permission
   * set.
   */
  replacePermissions(role: Role, permissions: readonly Permission[]): Promise<Role>;
}
