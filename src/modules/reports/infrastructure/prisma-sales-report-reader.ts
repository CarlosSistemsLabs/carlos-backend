import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type {
  ISalesReportReader,
  SalesReportData,
  SalesReportDailyBucket,
  SalesReportFilters,
} from '../domain/ports/sales-report-reader.js';

/** Anything that stringifies to a decimal (Prisma `Decimal`, number or string). */
export interface DecimalLike {
  toString(): string;
}

/** Shape returned by `sale.aggregate` for the window totals. */
export interface SaleAggregateResult {
  _count: number;
  _sum: {
    subtotal: DecimalLike | null;
    taxAmount: DecimalLike | null;
    total: DecimalLike | null;
  };
}

/** The per-sale columns projected for the daily breakdown. */
export interface SaleDailyRow {
  saleDate: Date;
  subtotal: DecimalLike;
  taxAmount: DecimalLike;
  total: DecimalLike;
}

/** Minimal `sale` delegate surface used by the reader. */
export interface SaleReportDelegate {
  aggregate(args: {
    where?: Record<string, unknown>;
    _count: true;
    _sum: { subtotal: true; taxAmount: true; total: true };
  }): Promise<SaleAggregateResult>;
  findMany(args: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<SaleDailyRow[]>;
}

/** A Prisma-like client exposing the `sale` delegate. */
export interface SalesReportPrismaClient {
  sale: SaleReportDelegate;
}

/** Only completed sales count towards reporting figures (drafts/cancelled excluded). */
const COMPLETED_STATUS = 'completed';

/**
 * Prisma-backed {@link ISalesReportReader}.
 *
 * Window **totals** are computed with a single `sale.aggregate`
 * (`_count` + `_sum` of `subtotal`/`taxAmount`/`total`) so the database does the
 * summing. The **per-day breakdown** projects only the four columns it needs
 * (`saleDate` + the three money columns) and buckets them by calendar day
 * in-process — Prisma `groupBy` cannot truncate a timestamp to a day without
 * raw SQL, so day bucketing is done here (raw-SQL/index tuning is deferred to
 * task 25.2). Scoped by `tenantId`, excludes soft-deleted and non-completed
 * sales, and rehydrates the bare `Decimal` columns into {@link Money} with the
 * configured currency.
 */
export class PrismaSalesReportReader implements ISalesReportReader {
  constructor(
    private readonly prisma: SalesReportPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async salesSummary(tenantId: UUID, filters: SalesReportFilters): Promise<SalesReportData> {
    const where = this.buildWhere(tenantId, filters);

    const [aggregate, rows] = await Promise.all([
      this.prisma.sale.aggregate({
        where,
        _count: true,
        _sum: { subtotal: true, taxAmount: true, total: true },
      }),
      this.prisma.sale.findMany({
        where,
        select: { saleDate: true, subtotal: true, taxAmount: true, total: true },
        orderBy: { saleDate: 'asc' },
      }),
    ]);

    return {
      totals: {
        count: aggregate._count,
        subtotal: this.toMoney(aggregate._sum.subtotal),
        tax: this.toMoney(aggregate._sum.taxAmount),
        total: this.toMoney(aggregate._sum.total),
      },
      daily: this.bucketByDay(rows),
    };
  }

  private buildWhere(tenantId: UUID, filters: SalesReportFilters): Record<string, unknown> {
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      status: COMPLETED_STATUS,
      saleDate: { gte: filters.from, lte: filters.to },
    };
    if (filters.customerId !== undefined) {
      where.customerId = filters.customerId;
    }
    if (filters.branchId !== undefined) {
      where.branchId = filters.branchId;
    }
    return where;
  }

  /** Groups pre-sorted rows into per-calendar-day buckets (UTC day key). */
  private bucketByDay(rows: SaleDailyRow[]): SalesReportDailyBucket[] {
    const buckets = new Map<string, SalesReportDailyBucket>();
    for (const row of rows) {
      const key = row.saleDate.toISOString().slice(0, 10);
      const existing = buckets.get(key);
      if (existing === undefined) {
        buckets.set(key, {
          date: key,
          count: 1,
          subtotal: this.toMoney(row.subtotal),
          tax: this.toMoney(row.taxAmount),
          total: this.toMoney(row.total),
        });
        continue;
      }
      existing.count += 1;
      existing.subtotal = existing.subtotal.add(this.toMoney(row.subtotal));
      existing.tax = existing.tax.add(this.toMoney(row.taxAmount));
      existing.total = existing.total.add(this.toMoney(row.total));
    }
    return [...buckets.values()];
  }

  private toMoney(value: DecimalLike | null): Money {
    return value === null
      ? Money.zero(this.currency)
      : Money.fromDecimal(value.toString(), this.currency);
  }
}
