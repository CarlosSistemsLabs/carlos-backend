import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import { Sale } from '../domain/entities/sale.js';
import { SaleDetail } from '../domain/entities/sale-detail.js';
import { assertSaleStatus, type SaleStatus } from '../domain/value-objects/sale-status.js';
import type {
  ISaleRepository,
  SaleFilters,
  SaleQuery,
  SaleSort,
} from '../domain/repositories/sale-repository.js';

/**
 * Anything that stringifies to a decimal — covers Prisma's `Decimal` runtime
 * type as well as plain `number`/`string` values used in tests. Keeping the
 * mapper structural (rather than importing `Prisma.Decimal`) lets the repository
 * be exercised with trivial fake delegates.
 */
export interface DecimalLike {
  toString(): string;
}

/** Persistence row for a `SaleDetail` (structural subset of Prisma's type). */
export interface SaleDetailRow {
  id: string;
  saleId: string;
  productId: string;
  quantity: number;
  unitPrice: DecimalLike;
  taxRate: DecimalLike;
  subtotal: DecimalLike;
  taxAmount: DecimalLike;
  total: DecimalLike;
}

/** Persistence row for a `Sale` (structural subset of Prisma's type). */
export interface SaleRow {
  id: string;
  tenantId: string;
  customerId: string;
  branchId: string | null;
  userId: string;
  saleNumber: string;
  saleDate: Date;
  status: string;
  subtotal: DecimalLike;
  taxAmount: DecimalLike;
  total: DecimalLike;
  notes: string | null;
}

/** A `Sale` row joined with its line items (via a Prisma `include`). */
export interface SaleRowWithDetails extends SaleRow {
  details: SaleDetailRow[];
}

/** Arguments accepted by the `sale` delegate's read methods. */
export interface SaleFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  include?: Record<string, unknown>;
  skip?: number;
  take?: number;
}

/** Minimal `sale` delegate surface used by {@link PrismaSaleRepository}. */
export interface SaleModelDelegate {
  findFirst(args: SaleFindArgs): Promise<SaleRowWithDetails | null>;
  findMany(args: SaleFindArgs): Promise<SaleRowWithDetails[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<SaleRowWithDetails>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<SaleRow>;
}

/** A Prisma-like client exposing (at least) the `sale` delegate. */
export interface SalePrismaClient {
  sale: SaleModelDelegate;
}

/** Zero-padded width of the numeric part of a sale number (e.g. `SALE-000001`). */
const SALE_NUMBER_PAD = 6;
const SALE_NUMBER_PREFIX = 'SALE-';

/** Always include line items when reading a sale. */
const INCLUDE_DETAILS = { details: true };

/** Default ordering applied when a query omits an explicit sort. */
const DEFAULT_SORT: SaleSort = { field: 'saleDate', direction: 'desc' };

/**
 * Prisma-backed {@link ISaleRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on writes/reads.
 * Methods still receive `tenantId` explicitly and apply it to the `where` clause
 * for defence-in-depth (Requirement 1.5).
 *
 * **Money ⇄ Decimal mapping:** `Sale`/`SaleDetail` store money as bare `Decimal`
 * columns with no currency, so {@link Money} is rehydrated using a configured
 * currency (defaulting to the tenant base currency). Writes use
 * {@link Money.toDecimalString} so the stored value matches the value object
 * exactly with no drift.
 *
 * **Atomic create:** {@link create} inserts the header and every line in one
 * nested Prisma `create`. It is expected to run inside {@link
 * import('../domain/repositories/sale-unit-of-work.js').ISaleUnitOfWork}, which
 * also brackets {@link nextSaleNumber} so numbering + insertion share a commit.
 */
export class PrismaSaleRepository implements ISaleRepository {
  constructor(
    private readonly prisma: SalePrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async findById(id: UUID): Promise<Sale | null> {
    const row = await this.prisma.sale.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE_DETAILS,
    });
    return row === null ? null : this.toDomain(row);
  }

  async findMany(tenantId: UUID, query: SaleQuery): Promise<PaginatedResult<Sale>> {
    const where = this.buildWhere(tenantId, query.filters);
    const sort = query.sort ?? DEFAULT_SORT;
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: INCLUDE_DETAILS,
        orderBy: { [sort.field]: sort.direction },
        skip,
        take: query.pageSize,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async create(sale: Sale): Promise<Sale> {
    const totals = sale.recalculateTotals();
    const row = await this.prisma.sale.create({
      data: {
        id: sale.id,
        tenantId: sale.tenantId,
        customerId: sale.customerId,
        branchId: sale.branchId,
        userId: sale.userId,
        saleNumber: sale.saleNumber,
        saleDate: sale.saleDate,
        status: sale.status,
        subtotal: totals.subtotal.toDecimalString(),
        taxAmount: totals.taxAmount.toDecimalString(),
        total: totals.total.toDecimalString(),
        notes: sale.notes,
        details: {
          create: sale.items.map((line) => ({
            id: line.id,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice.toDecimalString(),
            taxRate: line.taxRate,
            subtotal: line.subtotal.toDecimalString(),
            taxAmount: line.taxAmount.toDecimalString(),
            total: line.total.toDecimalString(),
          })),
        },
      },
      include: INCLUDE_DETAILS,
    });
    return this.toDomain(row);
  }

  async updateStatus(id: UUID, status: SaleStatus): Promise<void> {
    await this.prisma.sale.update({ where: { id }, data: { status } });
  }

  async softDelete(id: UUID): Promise<void> {
    await this.prisma.sale.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async nextSaleNumber(tenantId: UUID): Promise<string> {
    const count = await this.prisma.sale.count({ where: { tenantId } });
    const next = (count + 1).toString().padStart(SALE_NUMBER_PAD, '0');
    return `${SALE_NUMBER_PREFIX}${next}`;
  }

  /** Builds the `where` clause: tenant scope, soft-delete filter and filters. */
  private buildWhere(tenantId: UUID, filters: SaleFilters | undefined): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (filters === undefined) {
      return where;
    }
    if (filters.customerId !== undefined) {
      where.customerId = filters.customerId;
    }
    if (filters.branchId !== undefined) {
      where.branchId = filters.branchId;
    }
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      const range: Record<string, Date> = {};
      if (filters.from !== undefined) {
        range.gte = filters.from;
      }
      if (filters.to !== undefined) {
        range.lte = filters.to;
      }
      where.saleDate = range;
    }
    return where;
  }

  /** Maps a persistence row (with details) to the {@link Sale} aggregate. */
  private toDomain(row: SaleRowWithDetails): Sale {
    const items = row.details.map((detail) => this.detailToDomain(detail));
    return Sale.reconstitute(row.id, {
      tenantId: row.tenantId,
      customerId: row.customerId,
      branchId: row.branchId as Nullable<UUID>,
      userId: row.userId,
      saleNumber: row.saleNumber,
      saleDate: row.saleDate,
      status: assertSaleStatus(row.status),
      items,
      notes: row.notes,
      currency: this.currency,
    });
  }

  private detailToDomain(row: SaleDetailRow): SaleDetail {
    return SaleDetail.reconstitute(row.id, {
      productId: row.productId,
      quantity: row.quantity,
      unitPrice: Money.fromDecimal(row.unitPrice.toString(), this.currency),
      taxRate: Number(row.taxRate.toString()),
    });
  }
}
