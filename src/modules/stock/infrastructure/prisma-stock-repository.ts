import { Prisma } from '@prisma/client';
import { safeQueryRaw, type SafeQueryExecutor } from '@infrastructure/database/safe-query.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import { Stock } from '../domain/entities/stock.js';
import type {
  IStockRepository,
  StockLevelFilters,
  StockLevelQuery,
  StockLevelView,
} from '../domain/repositories/stock-repository.js';

/** Persistence row shape for the `Stock` model (structural subset of Prisma's type). */
export interface StockRow {
  id: string;
  tenantId: string;
  productId: string;
  branchId: string | null;
  quantity: number;
}

/**
 * A `Stock` row joined with its product's `name` and `minStock` (via a Prisma
 * `include`), used to build a {@link StockLevelView}.
 */
export interface StockRowWithProduct extends StockRow {
  product: { name: string; minStock: number };
}

/** A low-stock row as returned by the raw `findLowStock` query. */
export interface LowStockRow {
  id: string;
  tenantId: string;
  productId: string;
  branchId: string | null;
  quantity: number;
  productName: string;
  minStock: number;
}

/** Arguments accepted by the `stock` delegate's read methods. */
export interface StockFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  include?: Record<string, unknown>;
  skip?: number;
  take?: number;
}

/** Minimal `stock` delegate surface used by {@link PrismaStockRepository}. */
export interface StockModelDelegate {
  findFirst(args: StockFindArgs): Promise<StockRow | null>;
  findMany(args: StockFindArgs): Promise<StockRowWithProduct[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<StockRow>;
}

/**
 * A Prisma-like client exposing the `stock` delegate plus parameterised
 * raw-query access. Raw access is the TAGGED-TEMPLATE `$queryRaw` (accepting a
 * `Prisma.Sql`), never the `$queryRawUnsafe` string variant — see
 * {@link SafeQueryExecutor} and the database README (task 43.2, Req 17.6).
 */
export interface StockPrismaClient extends SafeQueryExecutor {
  stock: StockModelDelegate;
}

/** Default ordering (by product name) applied to stock-level listings. */
const ORDER_BY_PRODUCT_NAME = { product: { name: 'asc' } };

/**
 * Prisma-backed {@link IStockRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on writes/reads.
 * Methods still receive and apply `tenantId` explicitly for defence-in-depth
 * (Requirement 1.5) and so it behaves correctly inside a raw query, where the
 * tenant extension does not apply.
 *
 * **Upsert keyed by id:** {@link save} upserts on the aggregate's stable `id`
 * rather than the `@@unique([tenantId, productId, branchId])` compound. This
 * sidesteps SQL's "every NULL is distinct" treatment of the nullable
 * `branchId` in the compound key: the caller (`AdjustStockUseCase`) always
 * loads-or-opens a `Stock` first, so a new balance carries a fresh id to insert
 * and an existing one carries its persisted id to update.
 *
 * **Low-stock query:** `quantity <= product.minStock` is a column-to-column
 * comparison Prisma's fluent API cannot express, so {@link findLowStock} uses a
 * parameterised raw query joining `Product`.
 */
export class PrismaStockRepository implements IStockRepository {
  constructor(private readonly prisma: StockPrismaClient) {}

  async findByProductBranch(
    tenantId: UUID,
    productId: UUID,
    branchId: Nullable<UUID>,
  ): Promise<Stock | null> {
    const row = await this.prisma.stock.findFirst({
      where: { tenantId, productId, branchId },
    });
    return row === null ? null : this.toDomain(row);
  }

  async findByTenant(
    tenantId: UUID,
    query: StockLevelQuery,
  ): Promise<PaginatedResult<StockLevelView>> {
    const where = this.buildWhere(tenantId, query.filters);
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.stock.findMany({
        where,
        include: { product: { select: { name: true, minStock: true } } },
        orderBy: ORDER_BY_PRODUCT_NAME,
        skip,
        take: query.pageSize,
      }),
      this.prisma.stock.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toLevelView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async findLowStock(
    tenantId: UUID,
    query: StockLevelQuery,
  ): Promise<PaginatedResult<StockLevelView>> {
    const skip = (query.page - 1) * query.pageSize;
    const filters = query.filters ?? {};

    // Build a parameterised WHERE incrementally with Prisma.sql tagged fragments
    // so optional filters cannot open SQL-injection vectors: every interpolated
    // value is auto-bound as a placeholder (never inlined), and the fragments
    // are composed with Prisma.join. Column/table identifiers are all constant.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`s."tenantId" = ${tenantId}`,
      Prisma.sql`p."deletedAt" IS NULL`,
      Prisma.sql`s.quantity <= p."minStock"`,
    ];

    if (filters.productId !== undefined) {
      conditions.push(Prisma.sql`s."productId" = ${filters.productId}`);
    }
    if (filters.branchId !== undefined) {
      if (filters.branchId === null) {
        conditions.push(Prisma.sql`s."branchId" IS NULL`);
      } else {
        conditions.push(Prisma.sql`s."branchId" = ${filters.branchId}`);
      }
    }

    const whereSql = Prisma.join(conditions, ' AND ');

    const rowsSql = Prisma.sql`SELECT s.id, s."tenantId", s."productId", s."branchId", s.quantity, p.name AS "productName", p."minStock" AS "minStock" FROM "Stock" s JOIN "Product" p ON p.id = s."productId" WHERE ${whereSql} ORDER BY p.name ASC LIMIT ${query.pageSize} OFFSET ${skip}`;
    const countSql = Prisma.sql`SELECT COUNT(*)::int AS count FROM "Stock" s JOIN "Product" p ON p.id = s."productId" WHERE ${whereSql}`;

    const [rows, countRows] = await Promise.all([
      safeQueryRaw<LowStockRow[]>(this.prisma, rowsSql),
      safeQueryRaw<Array<{ count: number }>>(this.prisma, countSql),
    ]);

    const total = countRows[0]?.count ?? 0;
    return {
      items: rows.map((row) => this.lowRowToLevelView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async save(stock: Stock): Promise<Stock> {
    const row = await this.prisma.stock.upsert({
      where: { id: stock.id },
      create: {
        id: stock.id,
        tenantId: stock.tenantId,
        productId: stock.productId,
        branchId: stock.branchId,
        quantity: stock.quantity,
      },
      update: { quantity: stock.quantity },
    });
    return this.toDomain(row);
  }

  /** Builds the `where` clause: tenant scope plus optional product/branch filters. */
  private buildWhere(
    tenantId: UUID,
    filters: StockLevelFilters | undefined,
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
    return where;
  }

  private toDomain(row: StockRow): Stock {
    return Stock.reconstitute(row.id, {
      tenantId: row.tenantId,
      productId: row.productId,
      branchId: row.branchId,
      quantity: row.quantity,
    });
  }

  private toLevelView(row: StockRowWithProduct): StockLevelView {
    return {
      stock: this.toDomain(row),
      productName: row.product.name,
      minStock: row.product.minStock,
    };
  }

  private lowRowToLevelView(row: LowStockRow): StockLevelView {
    return {
      stock: Stock.reconstitute(row.id, {
        tenantId: row.tenantId,
        productId: row.productId,
        branchId: row.branchId,
        quantity: row.quantity,
      }),
      productName: row.productName,
      minStock: row.minStock,
    };
  }
}
