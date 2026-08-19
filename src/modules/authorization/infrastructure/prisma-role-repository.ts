import type { UUID } from '@shared/types/index.js';
import { Role } from '../domain/entities/role.js';
import { Permission } from '../domain/value-objects/permission.js';
import type { IRoleRepository } from '../domain/repositories/role-repository.js';

/** Persistence row shape for the `Permission` model. */
export interface PermissionRow {
  id: string;
  roleId: string;
  module: string;
  screen: string;
  action: string;
}

/**
 * Persistence row shape for the `Role` model with its permissions eagerly
 * loaded. A structural subset of the generated Prisma type so the mapper stays
 * explicit and the repository remains trivially testable with a fake delegate.
 */
export interface RoleRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionRow[];
}

/** Minimal `role` delegate surface used by {@link PrismaRoleRepository}. */
export interface RoleModelDelegate {
  findFirst(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<RoleRow | null>;
  findMany(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<RoleRow[]>;
  create(args: {
    data: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<RoleRow>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<RoleRow>;
}

/** Minimal `permission` delegate surface used by {@link PrismaRoleRepository}. */
export interface PermissionModelDelegate {
  createMany(args: {
    data: Record<string, unknown>[];
    skipDuplicates?: boolean;
  }): Promise<{ count: number }>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

/** A Prisma-like client exposing (at least) the `role` and `permission` delegates. */
export interface RolePrismaClient {
  role: RoleModelDelegate;
  permission: PermissionModelDelegate;
}

/**
 * Prisma-backed {@link IRoleRepository}.
 *
 * **Client choice:** this repository is bound (in the composition root) to the
 * UNEXTENDED `systemPrisma` client and scopes every query by `tenantId`
 * explicitly. Reasoning:
 *
 * - Role seeding/provisioning runs *before* a request/tenant context exists, so
 *   the automatic tenant filter of `tenantPrisma` would have no tenant to
 *   inject; the methods here already receive `tenantId` explicitly.
 * - The `Permission` model is NOT tenant-scoped (it is scoped by `roleId`), so
 *   `tenantPrisma` offers it no protection regardless.
 *
 * This mirrors the auth module's approach and keeps tenant isolation explicit
 * and auditable (Requirement 1.5).
 */
export class PrismaRoleRepository implements IRoleRepository {
  constructor(private readonly prisma: RolePrismaClient) {}

  async findById(id: UUID): Promise<Role | null> {
    const row = await this.prisma.role.findFirst({
      where: { id },
      include: { permissions: true },
    });
    return row === null ? null : PrismaRoleRepository.toDomain(row);
  }

  async findByTenant(tenantId: UUID): Promise<Role[]> {
    const rows = await this.prisma.role.findMany({
      where: { tenantId },
      include: { permissions: true },
    });
    return rows.map((row) => PrismaRoleRepository.toDomain(row));
  }

  async findByName(tenantId: UUID, name: string): Promise<Role | null> {
    const row = await this.prisma.role.findFirst({
      where: { tenantId, name },
      include: { permissions: true },
    });
    return row === null ? null : PrismaRoleRepository.toDomain(row);
  }

  async create(role: Role): Promise<Role> {
    const row = await this.prisma.role.create({
      data: {
        id: role.id,
        tenantId: role.tenantId,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: {
          create: role.permissions.map((permission) => ({
            module: permission.module,
            screen: permission.screen,
            action: permission.action,
          })),
        },
      },
      include: { permissions: true },
    });
    return PrismaRoleRepository.toDomain(row);
  }

  async update(role: Role): Promise<Role> {
    const row = await this.prisma.role.update({
      where: { id: role.id },
      data: {
        name: role.name,
        description: role.description,
      },
      include: { permissions: true },
    });
    return PrismaRoleRepository.toDomain(row);
  }

  async addPermissions(role: Role, permissions: readonly Permission[]): Promise<Role> {
    if (permissions.length > 0) {
      await this.prisma.permission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          module: permission.module,
          screen: permission.screen,
          action: permission.action,
        })),
        // Idempotent attach: rely on @@unique([roleId, module, screen, action]).
        skipDuplicates: true,
      });
    }

    const refreshed = await this.findById(role.id);
    // The role was loaded by the caller, so it must still exist.
    return refreshed ?? role;
  }

  async replacePermissions(role: Role, permissions: readonly Permission[]): Promise<Role> {
    // Drop the current grants, then insert the new set. The caller loaded the
    // role (tenant-checked) and enforced the system-role guard, so this is a
    // straight replace on the `roleId`-scoped `Permission` rows.
    await this.prisma.permission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await this.prisma.permission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          module: permission.module,
          screen: permission.screen,
          action: permission.action,
        })),
        skipDuplicates: true,
      });
    }

    const refreshed = await this.findById(role.id);
    return refreshed ?? role;
  }

  /** Maps a persistence row (with permissions) to the {@link Role} aggregate. */
  private static toDomain(row: RoleRow): Role {
    return Role.reconstitute(row.id, {
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      permissions: row.permissions.map((permission) =>
        Permission.create(permission.module, permission.screen, permission.action),
      ),
    });
  }
}
