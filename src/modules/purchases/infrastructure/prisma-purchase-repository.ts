import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import { Purchase } from '../domain/entities/purchase.js';
import { PurchaseDetail } from '../domain/entities/purchase-detail.js';
import {
  assertPurchaseStatus,
  type PurchaseStatus,
} from '../domain/value-objects/purchase-status.js';
import type {
  IPurchaseRepository,
  PurchaseFilters,
  PurchaseQuery,
  PurchaseSort,
} from '../domain/repositories/purchase-repository.js';

/**
 * Anything that stringifies to a decimal — covers Prisma's `Decimal` runtime
 * type as well as plain `number`/`string` values used in tests. Keeping the
 * mapper structural (rather than importing `Prisma.Decimal`) lets the repository
 * be exercised with trivial fake delegates.
 */
export interface DecimalLike {
  toString(): string;
}

/** Persistence row for a `PurchaseDetail` (structural subset of Prisma's type). */
export interface PurchaseDetailRow {
  id: string;
  purchaseId: string;
  productId: string;
  quantity: number;
  unitCost: DecimalLike;
  taxRate: DecimalLike;
  subtotal: DecimalLike;
  taxAmount: DecimalLike;
  total: DecimalLike;
}

/** Persistence row for a `Purchase` (structural subset of Prisma's type). */
export interface PurchaseRow {
  id: string;
  tenantId: string;
  supplierId: string;
  userId: string;
  purchaseNumber: string;
  purchaseDate: Date;
  status: string;
  subtotal: DecimalLike;
  taxAmount: DecimalLike;
  total: DecimalLike;
  notes: string | null;
}

/** A `Purchase` row joined with its line items (via a Prisma `include`). */
export interface PurchaseRowWithDetails extends PurchaseRow {
  details: PurchaseDetailRow[];
}

/** Arguments accepted by the `purchase` delegate's read methods. */
export interface PurchaseFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  include?: Record<string, unknown>;
  skip?: number;
  take?: number;
}

/** Minimal `purchase` delegate surface used by {@link PrismaPurchaseRepository}. */
export interface PurchaseModelDelegate {
  findFirst(args: PurchaseFindArgs): Promise<PurchaseRowWithDetails | null>;
  findMany(args: PurchaseFindArgs): Promise<PurchaseRowWithDetails[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: {
    data: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<PurchaseRowWithDetails>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<PurchaseRow>;
}

/** A Prisma-like client exposing (at least) the `purchase` delegate. */
export interface PurchasePrismaClient {
  purchase: PurchaseModelDelegate;
}

/** Zero-padded width of the numeric part of a purchase number (e.g. `PUR-000001`). */
const PURCHASE_NUMBER_PAD = 6;
const PURCHASE_NUMBER_PREFIX = 'PUR-';

/** Always include line items when reading a purchase. */
const INCLUDE_DETAILS = { details: true };

/** Default ordering applied when a query omits an explicit sort. */
const DEFAULT_SORT: PurchaseSort = { field: 'purchaseDate', direction: 'desc' };

/**
 * Prisma-backed {@link IPurchaseRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on writes/reads.
 * Methods still receive `tenantId` explicitly and apply it to the `where` clause
 * for defence-in-depth (Requirement 1.5).
 *
 * **Money ⇄ Decimal mapping:** `Purchase`/`PurchaseDetail` store money as bare
 * `Decimal` columns with no currency, so {@link Money} is rehydrated using a
 * configured currency (defaulting to the tenant base currency). Writes use
 * {@link Money.toDecimalString} so the stored value matches the value object
 * exactly with no drift. Note the line column is `unitCost` (what the tenant
 * pays the supplier), not `unitPrice`.
 *
 * **Atomic create:** {@link create} inserts the header and every line in one
 * nested Prisma `create`. It is expected to run inside {@link
 * import('../domain/repositories/purchase-unit-of-work.js').IPurchaseUnitOfWork},
 * which also brackets {@link nextPurchaseNumber} so numbering + insertion share
 * a commit.
 */
export class PrismaPurchaseRepository implements IPurchaseRepository {
  constructor(
    private readonly prisma: PurchasePrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async findById(id: UUID): Promise<Purchase | null> {
    const row = await this.prisma.purchase.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE_DETAILS,
    });
    return row === null ? null : this.toDomain(row);
  }

  async findMany(tenantId: UUID, query: PurchaseQuery): Promise<PaginatedResult<Purchase>> {
    const where = this.buildWhere(tenantId, query.filters);
    const sort = query.sort ?? DEFAULT_SORT;
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: INCLUDE_DETAILS,
        orderBy: { [sort.field]: sort.direction },
        skip,
        take: query.pageSize,
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async create(purchase: Purchase): Promise<Purchase> {
    const totals = purchase.recalculateTotals();
    const row = await this.prisma.purchase.create({
      data: {
        id: purchase.id,
        tenantId: purchase.tenantId,
        supplierId: purchase.supplierId,
        userId: purchase.userId,
        purchaseNumber: purchase.purchaseNumber,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
        subtotal: totals.subtotal.toDecimalString(),
        taxAmount: totals.taxAmount.toDecimalString(),
        total: totals.total.toDecimalString(),
        notes: purchase.notes,
        details: {
          create: purchase.items.map((line) => ({
            id: line.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost.toDecimalString(),
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

  async updateStatus(id: UUID, status: PurchaseStatus): Promise<void> {
    await this.prisma.purchase.update({ where: { id }, data: { status } });
  }

  async softDelete(id: UUID): Promise<void> {
    await this.prisma.purchase.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async nextPurchaseNumber(tenantId: UUID): Promise<string> {
    const count = await this.prisma.purchase.count({ where: { tenantId } });
    const next = (count + 1).toString().padStart(PURCHASE_NUMBER_PAD, '0');
    return `${PURCHASE_NUMBER_PREFIX}${next}`;
  }

  /** Builds the `where` clause: tenant scope, soft-delete filter and filters. */
  private buildWhere(
    tenantId: UUID,
    filters: PurchaseFilters | undefined,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (filters === undefined) {
      return where;
    }
    if (filters.supplierId !== undefined) {
      where.supplierId = filters.supplierId;
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
      where.purchaseDate = range;
    }
    return where;
  }

  /** Maps a persistence row (with details) to the {@link Purchase} aggregate. */
  private toDomain(row: PurchaseRowWithDetails): Purchase {
    const items = row.details.map((detail) => this.detailToDomain(detail));
    return Purchase.reconstitute(row.id, {
      tenantId: row.tenantId,
      supplierId: row.supplierId,
      userId: row.userId,
      purchaseNumber: row.purchaseNumber,
      purchaseDate: row.purchaseDate,
      status: assertPurchaseStatus(row.status),
      items,
      notes: row.notes,
      currency: this.currency,
    });
  }

  private detailToDomain(row: PurchaseDetailRow): PurchaseDetail {
    return PurchaseDetail.reconstitute(row.id, {
      productId: row.productId,
      quantity: row.quantity,
      unitCost: Money.fromDecimal(row.unitCost.toString(), this.currency),
      taxRate: Number(row.taxRate.toString()),
    });
  }
}
