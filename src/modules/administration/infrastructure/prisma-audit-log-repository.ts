import type { PaginatedResult, UUID } from '@shared/types/index.js';
import type {
  AuditLogQuery,
  AuditLogRecord,
  IAuditLogRepository,
} from '../domain/repositories/audit-log-repository.js';

/**
 * Persistence row shape for the `AuditLog` model. A structural subset of the
 * generated Prisma type so the mapper stays explicit and the repository remains
 * trivially testable with a fake delegate.
 */
export interface AuditLogRow {
  id: string;
  tenantId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
}

/** Minimal `auditLog` delegate surface used by the repository (read-only). */
export interface AuditLogModelDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
    skip?: number;
    take?: number;
  }): Promise<AuditLogRow[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/** A Prisma-like client exposing (at least) the `auditLog` delegate. */
export interface AuditLogPrismaClient {
  auditLog: AuditLogModelDelegate;
}

/**
 * Prisma-backed, read-only {@link IAuditLogRepository} (Requirement 18.4).
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on every query;
 * this repository additionally applies `tenantId` explicitly in the `where`
 * clause for defence-in-depth so a query can never span tenants (Requirement
 * 1.5). Results are ordered newest-first and paginated with `skip`/`take`; the
 * `[tenantId]` and `[timestamp]` indexes on `AuditLog` keep tenant-scoped reads
 * within the 3-second budget (Requirement 18.4). No write methods are exposed —
 * the trail is append-only and immutable (Requirement 18.5).
 */
export class PrismaAuditLogRepository implements IAuditLogRepository {
  constructor(private readonly prisma: AuditLogPrismaClient) {}

  async findMany(tenantId: UUID, query: AuditLogQuery): Promise<PaginatedResult<AuditLogRecord>> {
    const filters = query.filters ?? {};
    const where: Record<string, unknown> = { tenantId };

    if (filters.entityType !== undefined) {
      where.entityType = filters.entityType;
    }
    if (filters.entityId !== undefined) {
      where.entityId = filters.entityId;
    }
    if (filters.userId !== undefined) {
      where.userId = filters.userId;
    }
    if (filters.action !== undefined) {
      where.action = filters.action;
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      where.timestamp = {
        ...(filters.from !== undefined ? { gte: filters.from } : {}),
        ...(filters.to !== undefined ? { lte: filters.to } : {}),
      };
    }

    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    return {
      items: rows.map((row) => PrismaAuditLogRepository.toRecord(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  /** Maps a persistence row to an {@link AuditLogRecord}. */
  private static toRecord(row: AuditLogRow): AuditLogRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      oldValues: row.oldValues ?? null,
      newValues: row.newValues ?? null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      timestamp: row.timestamp,
    };
  }
}
