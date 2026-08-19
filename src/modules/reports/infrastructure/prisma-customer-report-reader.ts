import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type {
  ICustomerReportReader,
  CustomerReportData,
  CustomerReportFilters,
  TopCustomerItem,
} from '../domain/ports/customer-report-reader.js';

/** Anything that stringifies to a decimal (Prisma `Decimal`, number or string). */
export interface DecimalLike {
  toString(): string;
}

/** A `sale.groupBy` row grouped by `customerId`. */
export interface SaleCustomerGroupRow {
  customerId: string;
  _sum: { total: DecimalLike | null };
  _count: number;
}

/** A projected `customer` name row. */
export interface CustomerNameRow {
  id: string;
  name: string;
}

/** Minimal `sale` + `customer` delegate surface used by the reader. */
export interface CustomerReportPrismaClient {
  sale: {
    groupBy(args: {
      by: ['customerId'];
      where?: Record<string, unknown>;
      _sum: { total: true };
      _count: true;
      orderBy?: Record<string, unknown>;
      take?: number;
    }): Promise<SaleCustomerGroupRow[]>;
  };
  customer: {
    findMany(args: {
      where?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<CustomerNameRow[]>;
  };
}

const COMPLETED_STATUS = 'completed';

/**
 * Prisma-backed {@link ICustomerReportReader}.
 *
 * Ranks customers with a single `sale.groupBy` on `customerId`
 * (`_sum.total` desc, `take: limit`) so the database does the ranking + top-N
 * cut. A second `customer.findMany` resolves the display names for just the
 * ranked ids (avoiding importing the Customers module). Scoped by `tenantId`
 * over the inclusive window, counting only completed, non-deleted sales, and
 * rehydrates totals into {@link Money}.
 */
export class PrismaCustomerReportReader implements ICustomerReportReader {
  constructor(
    private readonly prisma: CustomerReportPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async topCustomers(
    tenantId: UUID,
    filters: CustomerReportFilters,
  ): Promise<CustomerReportData> {
    const groups = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        tenantId,
        deletedAt: null,
        status: COMPLETED_STATUS,
        saleDate: { gte: filters.from, lte: filters.to },
      },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: 'desc' } },
      take: filters.limit,
    });

    if (groups.length === 0) {
      return { customers: [] };
    }

    const names = await this.prisma.customer.findMany({
      where: { tenantId, id: { in: groups.map((group) => group.customerId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((row) => [row.id, row.name]));

    const customers: TopCustomerItem[] = groups.map((group) => ({
      customerId: group.customerId,
      customerName: nameById.get(group.customerId) ?? '',
      salesCount: group._count,
      totalPurchased:
        group._sum.total === null
          ? Money.zero(this.currency)
          : Money.fromDecimal(group._sum.total.toString(), this.currency),
    }));

    return { customers };
  }
}
