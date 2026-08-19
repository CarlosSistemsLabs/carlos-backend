import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type {
  ICashFlowReportReader,
  CashFlowCategoryBucket,
  CashFlowReportData,
  CashFlowReportFilters,
} from '../domain/ports/cash-flow-report-reader.js';

/** Anything that stringifies to a decimal (Prisma `Decimal`, number or string). */
export interface DecimalLike {
  toString(): string;
}

/** A `cashMovement.groupBy` row grouped by `type` + `category`. */
export interface CashMovementGroupRow {
  type: string;
  category: string;
  _sum: { amount: DecimalLike | null };
  _count: number;
}

/** Minimal `cashMovement` delegate surface used by the reader. */
export interface CashMovementReportDelegate {
  groupBy(args: {
    by: ['type', 'category'];
    where?: Record<string, unknown>;
    _sum: { amount: true };
    _count: true;
  }): Promise<CashMovementGroupRow[]>;
}

/** A Prisma-like client exposing the `cashMovement` delegate. */
export interface CashFlowReportPrismaClient {
  cashMovement: CashMovementReportDelegate;
}

const INCOME = 'INCOME';
const EXPENSE = 'EXPENSE';

/**
 * Prisma-backed {@link ICashFlowReportReader}.
 *
 * Uses a single `cashMovement.groupBy` over (`type`, `category`) with a summed
 * `amount` and per-group `_count` so the database performs the aggregation. The
 * top-line `income`/`expense`/`net` figures are folded from the grouped buckets
 * in-process (`net = income - expense`). Scoped by `tenantId` over the inclusive
 * `[from, to]` window and rehydrates the bare `Decimal` sums into {@link Money}
 * with the configured currency.
 */
export class PrismaCashFlowReportReader implements ICashFlowReportReader {
  constructor(
    private readonly prisma: CashFlowReportPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async cashFlow(tenantId: UUID, filters: CashFlowReportFilters): Promise<CashFlowReportData> {
    const where: Record<string, unknown> = {
      tenantId,
      date: { gte: filters.from, lte: filters.to },
    };
    if (filters.cashId !== undefined) {
      where.cashId = filters.cashId;
    }

    const groups = await this.prisma.cashMovement.groupBy({
      by: ['type', 'category'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    let income = Money.zero(this.currency);
    let expense = Money.zero(this.currency);
    const byCategory: CashFlowCategoryBucket[] = [];

    for (const group of groups) {
      const total = this.toMoney(group._sum.amount);
      byCategory.push({
        type: group.type,
        category: group.category,
        total,
        count: group._count,
      });
      if (group.type === INCOME) {
        income = income.add(total);
      } else if (group.type === EXPENSE) {
        expense = expense.add(total);
      }
    }

    return {
      income,
      expense,
      net: income.subtract(expense),
      byCategory,
    };
  }

  private toMoney(value: DecimalLike | null): Money {
    return value === null
      ? Money.zero(this.currency)
      : Money.fromDecimal(value.toString(), this.currency);
  }
}
