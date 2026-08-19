import type { UUID } from '@shared/types/index.js';
import type {
  CreateRefreshTokenInput,
  IRefreshTokenRepository,
  RefreshTokenRecord,
} from '../domain/repositories/refresh-token-repository.js';

/** Persistence row shape for the `RefreshToken` model. */
export interface RefreshTokenRow {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  isRevoked: boolean;
  createdAt: Date;
}

/** Minimal `RefreshToken` delegate surface used by the repository. */
export interface RefreshTokenModelDelegate {
  create(args: { data: Record<string, unknown> }): Promise<RefreshTokenRow>;
  findUnique(args: { where: Record<string, unknown> }): Promise<RefreshTokenRow | null>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<RefreshTokenRow>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

/** A Prisma-like client exposing (at least) the `refreshToken` delegate. */
export interface RefreshTokenPrismaClient {
  refreshToken: RefreshTokenModelDelegate;
}

/**
 * Prisma-backed {@link IRefreshTokenRepository}.
 *
 * Refresh tokens are not tenant-scoped (they are keyed by `userId` and used
 * during login before a tenant context is established), so this repository runs
 * against the UNEXTENDED `systemPrisma` client. It supports the rotation and
 * revocation strategy (Requirements 8.2, 8.3): {@link revoke} invalidates a
 * single presented token during rotation/logout, while {@link revokeAllForUser}
 * supports global sign-out.
 */
export class PrismaRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly prisma: RefreshTokenPrismaClient) {}

  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const row = await this.prisma.refreshToken.create({
      data: {
        userId: input.userId,
        token: input.token,
        expiresAt: input.expiresAt,
      },
    });
    return PrismaRefreshTokenRepository.toRecord(row);
  }

  async findByToken(token: string): Promise<RefreshTokenRecord | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { token } });
    return row === null ? null : PrismaRefreshTokenRepository.toRecord(row);
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { token },
      data: { isRevoked: true },
    });
  }

  async revokeAllForUser(userId: UUID): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  /** Maps a persistence row to the public {@link RefreshTokenRecord}. */
  private static toRecord(row: RefreshTokenRow): RefreshTokenRecord {
    return {
      id: row.id,
      userId: row.userId,
      token: row.token,
      expiresAt: row.expiresAt,
      isRevoked: row.isRevoked,
      createdAt: row.createdAt,
    };
  }
}
