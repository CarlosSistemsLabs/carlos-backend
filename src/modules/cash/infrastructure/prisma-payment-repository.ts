import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import { Payment } from '../domain/entities/payment.js';
import { assertPaymentMethod } from '../domain/value-objects/payment-method.js';
import type {
  IPaymentRepository,
  PaymentFilters,
  PaymentQuery,
} from '../domain/repositories/payment-repository.js';

/** Anything that stringifies to a decimal (Prisma `Decimal`, number or string). */
export interface DecimalLike {
  toString(): string;
}

/** Persistence row for a `Payment` (structural subset of Prisma's type). */
export interface PaymentRow {
  id: string;
  tenantId: string;
  saleId: string | null;
  purchaseId: string | null;
  method: string;
  amount: DecimalLike;
  reference: string | null;
  date: Date;
}

/** Arguments accepted by the `payment` delegate's read methods. */
export interface PaymentFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** Shape returned by the `payment` delegate's `aggregate` (sum of `amount`). */
export interface PaymentAggregateResult {
  _sum: { amount: DecimalLike | null };
}

/** Minimal `payment` delegate surface used by the repository. */
export interface PaymentModelDelegate {
  findMany(args: PaymentFindArgs): Promise<PaymentRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<PaymentRow>;
  aggregate(args: {
    where?: Record<string, unknown>;
    _sum: { amount: true };
  }): Promise<PaymentAggregateResult>;
}

/** A Prisma-like client exposing the `payment` delegate. */
export interface PaymentPrismaClient {
  payment: PaymentModelDelegate;
}

/** Payments are listed newest-first by default. */
const DEFAULT_ORDER_BY = { date: 'desc' } as const;

/**
 * Prisma-backed {@link IPaymentRepository}.
 *
 * Bound to the tenant-aware `tenantPrisma` client in the composition root and
 * applies `tenantId` explicitly for defence-in-depth (Requirement 1.5).
 * Payments are immutable, so only {@link create} and {@link findMany} are
 * exposed. Money maps to/from a bare `Decimal` column using a configured
 * currency.
 */
export class PrismaPaymentRepository implements IPaymentRepository {
  constructor(
    private readonly prisma: PaymentPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async create(payment: Payment): Promise<Payment> {
    const row = await this.prisma.payment.create({
      data: {
        id: payment.id,
        tenantId: payment.tenantId,
        saleId: payment.saleId,
        purchaseId: payment.purchaseId,
        method: payment.method,
        amount: payment.amount.toDecimalString(),
        reference: payment.reference,
        date: payment.date,
      },
    });
    return this.toDomain(row);
  }

  async findMany(tenantId: UUID, query: PaymentQuery): Promise<PaginatedResult<Payment>> {
    const where = this.buildWhere(tenantId, query.filters);
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: DEFAULT_ORDER_BY,
        skip,
        take: query.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async sumBySale(tenantId: UUID, saleId: UUID, currency: string): Promise<Money> {
    return this.sum({ tenantId, saleId }, currency);
  }

  async sumByPurchase(tenantId: UUID, purchaseId: UUID, currency: string): Promise<Money> {
    return this.sum({ tenantId, purchaseId }, currency);
  }

  /**
   * Sums the `amount` column over the payments matching `where`, returning zero
   * (in `currency`) when the aggregate is `null` (no matching rows).
   */
  private async sum(where: Record<string, unknown>, currency: string): Promise<Money> {
    const result = await this.prisma.payment.aggregate({ where, _sum: { amount: true } });
    const sum = result._sum.amount;
    return sum === null ? Money.zero(currency) : Money.fromDecimal(sum.toString(), currency);
  }

  private buildWhere(tenantId: UUID, filters: PaymentFilters | undefined): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId };
    if (filters === undefined) {
      return where;
    }
    if (filters.saleId !== undefined) {
      where.saleId = filters.saleId;
    }
    if (filters.purchaseId !== undefined) {
      where.purchaseId = filters.purchaseId;
    }
    if (filters.method !== undefined) {
      where.method = filters.method;
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      const date: Record<string, Date> = {};
      if (filters.from !== undefined) {
        date.gte = filters.from;
      }
      if (filters.to !== undefined) {
        date.lte = filters.to;
      }
      where.date = date;
    }
    return where;
  }

  private toDomain(row: PaymentRow): Payment {
    return Payment.reconstitute(row.id, {
      tenantId: row.tenantId,
      saleId: row.saleId as Nullable<UUID>,
      purchaseId: row.purchaseId as Nullable<UUID>,
      method: assertPaymentMethod(row.method),
      amount: Money.fromDecimal(row.amount.toString(), this.currency),
      reference: row.reference as Nullable<string>,
      date: row.date,
    });
  }
}
