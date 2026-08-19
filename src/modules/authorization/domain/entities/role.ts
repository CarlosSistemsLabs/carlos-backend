import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import type { Permission } from '../value-objects/permission.js';
import { SystemRoleModificationError } from '../errors/authorization-errors.js';

/** Attributes describing a role and the permissions granted to it. */
export interface RoleProps {
  tenantId: UUID;
  name: string;
  description: Nullable<string>;
  isSystem: boolean;
  permissions: Permission[];
}

/** Input accepted by {@link Role.create} when defining a new role. */
export interface CreateRoleInput {
  tenantId: UUID;
  name: string;
  description?: Nullable<string>;
  /** Marks the role as platform-managed (seeded). Defaults to `false`. */
  isSystem?: boolean;
  /** Optional initial permissions. Duplicates are de-duplicated. */
  permissions?: readonly Permission[];
}

/**
 * Role aggregate root (RBAC, Requirement 8.4).
 *
 * A role groups a set of {@link Permission}s and is assigned to users. Roles
 * are tenant-scoped: their name is unique per tenant (enforced by the
 * repository / `@@unique([tenantId, name])`).
 *
 * **System role guard (design decision):** seeded system roles (Admin, Manager,
 * User) protect their *core identity* — their {@link name} and {@link isSystem}
 * flag cannot change and their permissions cannot be removed via
 * {@link removePermission}. Adding permissions IS allowed so seeding can
 * populate them and so the matrix can be extended over time. Custom (non-system)
 * roles may be modified freely.
 */
export class Role extends AggregateRoot<RoleProps> {
  private constructor(props: RoleProps, id?: UUID) {
    super(props, id);
  }

  /** Defines a brand new role with optional seed permissions. */
  static create(input: CreateRoleInput, id?: UUID): Role {
    const permissions: Permission[] = [];
    for (const permission of input.permissions ?? []) {
      if (!permissions.some((existing) => existing.equals(permission))) {
        permissions.push(permission);
      }
    }

    return new Role(
      {
        tenantId: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        isSystem: input.isSystem ?? false,
        permissions,
      },
      id,
    );
  }

  /** Rehydrates a {@link Role} from persisted state. */
  static reconstitute(id: UUID, props: RoleProps): Role {
    return new Role({ ...props, permissions: [...props.permissions] }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): Nullable<string> {
    return this.props.description;
  }

  get isSystem(): boolean {
    return this.props.isSystem;
  }

  /** The permissions granted to this role (defensive read-only copy). */
  get permissions(): readonly Permission[] {
    return [...this.props.permissions];
  }

  /**
   * Adds a permission to the role. Idempotent: re-adding an equal permission is
   * a no-op, mirroring the `@@unique([roleId, module, screen, action])`
   * persistence constraint. Allowed on system roles (used during seeding).
   *
   * @returns `true` when the permission was newly added, `false` when it was
   *   already present.
   */
  addPermission(permission: Permission): boolean {
    if (this.props.permissions.some((existing) => existing.equals(permission))) {
      return false;
    }
    this.props.permissions.push(permission);
    return true;
  }

  /**
   * Removes a permission from the role.
   *
   * @throws {SystemRoleModificationError} when called on a system role.
   * @returns `true` when a matching permission was removed.
   */
  removePermission(permission: Permission): boolean {
    if (this.props.isSystem) {
      throw new SystemRoleModificationError(this.props.name, 'remove permissions from');
    }
    const index = this.props.permissions.findIndex((existing) => existing.equals(permission));
    if (index === -1) {
      return false;
    }
    this.props.permissions.splice(index, 1);
    return true;
  }

  /**
   * Replaces the role's entire permission set with the supplied permissions
   * (task 27.2 — admin "update role permissions"). Duplicates in the input are
   * de-duplicated, mirroring `Role.create`.
   *
   * @throws {SystemRoleModificationError} when called on a system role, whose
   *   permission set is protected (a system role's identity must stay stable).
   */
  replacePermissions(permissions: readonly Permission[]): void {
    if (this.props.isSystem) {
      throw new SystemRoleModificationError(this.props.name, 'modify the permissions of');
    }
    const next: Permission[] = [];
    for (const permission of permissions) {
      if (!next.some((existing) => existing.equals(permission))) {
        next.push(permission);
      }
    }
    this.props.permissions = next;
  }

  /**
   * Renames the role and/or updates its description.
   *
   * @throws {SystemRoleModificationError} when called on a system role, whose
   *   core identity (name) is immutable.
   */
  rename(name: string, description?: Nullable<string>): void {
    if (this.props.isSystem) {
      throw new SystemRoleModificationError(this.props.name, 'rename');
    }
    this.props.name = name;
    if (description !== undefined) {
      this.props.description = description;
    }
  }

  /**
   * Returns `true` when the role grants the requested permission, honouring
   * wildcards (`*`) on any of module/screen/action. This is the core check the
   * authorization middleware (task 9.2) relies on.
   */
  hasPermission(module: string, screen: string, action: string): boolean {
    return this.props.permissions.some((permission) => permission.matches(module, screen, action));
  }
}
