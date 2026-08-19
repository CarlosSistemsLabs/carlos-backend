import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { buildCursorPage, decodeCursor, type CursorPage } from '@shared/pagination/cursor.js';
import { StockMovement } from '../domain/entities/stock-movement.js';
import type {
  IStockMovementRepository,
  StockMovementFilters,
  StockMovementQuery,
} from '../domain/repositories/stock-movement-repository.js';
import type {
  IStockMovementCursorReader,
  StockMovementCursorQuery,
} from '../domain/repositories/stock-movement-cursor-reader.js';
import { assertStockMovementType } from '../domain/value-objects/stock-movement-type.js';

/** Persistence row shape for the `StockMovement` model. */
export interface StockMovementRow {
  id: string;
  tenantId: string;
  productId: string;
  branchId: string | null;
  type: string;
  quantity: number;
  reference: string | null;
  notes: string | null;
  createdAt: Date;
}

/** Arguments accepted by the `stockMovement` delegate's read methods. */
export interface StockMovementFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  select?: Record<string, unknown>;
  cursor?: Record<string, unknown>;
  skip?: number;
  take?: number;
}

/** Minimal `stockMovement` delegate surface used by the repository. */
export interface StockMovementModelDelegate {
  findMany(args: StockMovementFindArgs): Promise<StockMovementRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<StockMovementRow>;
}

/** A Prisma-like client exposing the `stockMovement` delegate. */
export interface StockMovementPrismaClient {
  stockMovement: StockMovementModelDelegate;
}

/** Movements are listed newest-first by default. */
const DEFAULT_ORDER_BY = { createdAt: 'desc' } as const;

/**
 * Stable ordering for cursor pagination: newest-first by `createdAt` with `id`
 * as the final tie-breaker. The tie-breaker is REQUIRED for keyset pagination —
 * without it two rows sharing a `createdAt` could be split across a page
 * boundary inconsistently, causing skipped or duplicated rows. `id` also matches
 * the field used for the Prisma `cursor`, so the resume point is unambiguous.
 */
const CURSOR_ORDER_BY = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/**
 * Columns projected by the cursor reader (query optimization, task 39.3). Only
 * the fields the row mapper consumes are selected, avoiding over-fetching any
 * wide/unused columns while keeping the output shape identical.
 */
const MOVEMENT_SELECT = {
  id: true,
  tenantId: true,
  productId: true,
  branchId: true,
  type: true,
  quantity: true,
  reference: true,
  notes: true,
  createdAt: true,
} as const;

/**
 * Prisma-backed {@link IStockMovementRepository}.
 *
 * Bound to the tenant-aware `tenantPrisma` client in the composition root and
 * applies `tenantId` explicitly for defence-in-depth (Requirement 1.5). The
 * audit trail is append-only, so only {@link create} and read methods are
 * exposed. Date-range filters translate to `gte`/`lte` on `createdAt`.
 */
export class PrismaStockMovementRepository
  implements IStockMovementRepository, IStockMovementCursorReader
{
  constructor(private readonly prisma: StockMovementPrismaClient) {}

  async create(movement: StockMovement): Promise<StockMovement> {
    const row = await this.prisma.stockMovement.create({
      data: {
        id: movement.id,
        tenantId: movement.tenantId,
        productId: movement.productId,
        branchId: movement.branchId,
        type: movement.type,
        quantity: movement.quantity,
        reference: movement.reference,
        notes: movement.notes,
        createdAt: movement.createdAt,
      },
    });
    return this.toDomain(row);
  }

  async findMany(
    tenantId: UUID,
    query: StockMovementQuery,
  ): Promise<PaginatedResult<StockMovement>> {
    const where = this.buildWhere(tenantId, query.filters);
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: DEFAULT_ORDER_BY,
        skip,
        take: query.pageSize,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async findManyByCursor(
    tenantId: UUID,
    query: StockMovementCursorQuery,
  ): Promise<CursorPage<StockMovement>> {
    const where = this.buildWhere(tenantId, query.filters);
    const decoded = decodeCursor(query.cursor);

    // Over-fetch one row (take = limit + 1) as the look-ahead used by
    // buildCursorPage to decide whether a further page exists — no COUNT needed.
    const args: StockMovementFindArgs = {
      where,
      orderBy: [...CURSOR_ORDER_BY],
      select: MOVEMENT_SELECT,
      take: query.limit + 1,
    };
    if (decoded !== null) {
      // Resume strictly AFTER the previous page's last row: seek to it by id
      // then skip it. A stale/tampered cursor decodes to null and is ignored
      // (falls back to the first page) rather than erroring.
      args.cursor = { id: decoded.id };
      args.skip = 1;
    }

    const rows = await this.prisma.stockMovement.findMany(args);
    return buildCursorPage(
      rows.map((row) => this.toDomain(row)),
      query.limit,
      (movement) => movement.id,
    );
  }

  private buildWhere(
    tenantId: UUID,
    filters: StockMovementFilters | undefined,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId };
    if (filters === undefined) {
      return where;
    }
    if (filters.productId !== undefined) {
      where.productId = filters.productId;
    }
    if (filters.branchId !== undefined) {
      where.branchId = filters.branchId;
    }
    if (filters.type !== undefined) {
      where.type = filters.type;
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      const createdAt: Record<string, Date> = {};
      if (filters.from !== undefined) {
        createdAt.gte = filters.from;
      }
      if (filters.to !== undefined) {
        createdAt.lte = filters.to;
      }
      where.createdAt = createdAt;
    }
    return where;
  }

  private toDomain(row: StockMovementRow): StockMovement {
    return StockMovement.reconstitute(row.id, {
      tenantId: row.tenantId,
      productId: row.productId,
      branchId: row.branchId,
      type: assertStockMovementType(row.type),
      quantity: row.quantity,
      reference: row.reference,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  }
}
