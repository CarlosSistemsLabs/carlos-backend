import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { AuthUser } from '../domain/entities/auth-user.js';
import type { IUserRepository, ListUsersQuery } from '../domain/repositories/user-repository.js';

/**
 * Persistence row shape for the `User` model consumed by this repository. A
 * structural subset of the generated Prisma type so the mapper stays explicit
 * and the repository remains trivially testable with a fake delegate.
 */
export interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatar: string | null;
  roleId: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/** Minimal `User` delegate surface used by {@link PrismaUserRepository}. */
export interface UserModelDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<UserRow | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<UserRow[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<UserRow>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<UserRow>;
}

/** A Prisma-like client exposing (at least) the `user` delegate. */
export interface UserPrismaClient {
  user: UserModelDelegate;
}

/**
 * Prisma-backed {@link IUserRepository}.
 *
 * Authentication lookups happen before a tenant context exists (login resolves
 * a user by email), so this repository runs against the UNEXTENDED
 * `systemPrisma` client and applies the `tenantId` constraint by hand wherever
 * the interface provides it — preserving tenant isolation without relying on
 * the automatic tenant filter (Requirement 1.5).
 */
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: UserPrismaClient) {}

  async findByEmail(tenantId: UUID, email: string): Promise<AuthUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { tenantId, email, deletedAt: null },
    });
    return row === null ? null : PrismaUserRepository.toDomain(row);
  }

  async findById(id: UUID): Promise<AuthUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    return row === null ? null : PrismaUserRepository.toDomain(row);
  }

  async listByTenant(tenantId: UUID, query: ListUsersQuery): Promise<PaginatedResult<AuthUser>> {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search !== undefined && query.search !== '') {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { email: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map(PrismaUserRepository.toDomain),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async create(user: AuthUser): Promise<AuthUser> {
    const row = await this.prisma.user.create({
      data: { id: user.id, ...PrismaUserRepository.toPersistence(user) },
    });
    return PrismaUserRepository.toDomain(row);
  }

  async update(user: AuthUser): Promise<AuthUser> {
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: PrismaUserRepository.toPersistence(user),
    });
    return PrismaUserRepository.toDomain(row);
  }

  /** Maps a persistence row to the {@link AuthUser} aggregate. */
  private static toDomain(row: UserRow): AuthUser {
    return AuthUser.reconstitute(row.id, {
      tenantId: row.tenantId,
      email: row.email,
      passwordHash: row.passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      roleId: row.roleId,
      phone: row.phone,
      avatar: row.avatar,
      isActive: row.isActive,
      lastLoginAt: row.lastLoginAt,
      failedLoginCount: row.failedLoginCount,
      lockedUntil: row.lockedUntil,
    });
  }

  /** Maps an {@link AuthUser} aggregate to a persistence payload. */
  private static toPersistence(user: AuthUser): Record<string, unknown> {
    return {
      tenantId: user.tenantId,
      email: user.email,
      passwordHash: user.passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      phone: user.phone,
      avatar: user.avatar,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      failedLoginCount: user.failedLoginCount,
      lockedUntil: user.lockedUntil,
    };
  }
}
