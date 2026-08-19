import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import { CashMovement } from '../domain/entities/cash-movement.js';
import {
  assertCashMovementType,
  cashMovementDelta,
} from '../domain/value-objects/cash-movement-type.js';
import { assertCashMovementCategory } from '../domain/value-objects/cash-movement-category.js';
import type {
  CashMovementFilters,
  CashMovementQuery,
  ICashMovementRepository,
} from '../domain/repositories/cash-movement-repository.js';

/** Anything that stringifies to a decimal (Prisma `Decimal`, number or string). */
export interface DecimalLike {
  toString(): string;
}

/** Persistence row for a `CashMovement` (structural subset of Prisma's type). */
export interface CashMovementRow {
  id: string;
  cashId: string;
  tenantId: string;
  userId: string;
  type: string;
  category: string;
  amount: DecimalLike;
  reference: string | null;
  description: string | null;
  date: Date;
}

/** Arguments accepted by the `cashMovement` delegate's read methods. */
export interface CashMovementFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** Minimal `cashMovement` delegate surface used by the repository. */
export interface CashMovementModelDelegate {
  findMany(args: CashMovementFindArgs): Promise<CashMovementRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<CashMovementRow>;
}

/** A Prisma-like client exposing the `cashMovement` delegate. */
export interface CashMovementPrismaClient {
  cashMovement: CashMovementModelDelegate;
}

/** Movements are listed newest-first by default. */
const DEFAULT_ORDER_BY = { date: 'desc' } as const;

/**
 * Prisma-backed {@link ICashMovementRepository}.
 *
 * Bound to the tenant-aware `tenantPrisma` client in the composition root and
 * applies `tenantId` explicitly for defence-in-depth (Requirement 1.5). The
 * ledger is append-only, so only {@link create}, {@link findMany} and
 * {@link sumByCash} are exposed. Date-range filters translate to `gte`/`lte` on
 * `date`. Money maps to/from a bare `Decimal` column using a configured
 * currency.
 */
export class PrismaCashMovementRepository implements ICashMovementRepository {
  constructor(
    private readonly prisma: CashMovementPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async create(movement: CashMovement): Promise<CashMovement> {
    const row = await this.prisma.cashMovement.create({
      data: {
        id: movement.id,
        cashId: movement.cashId,
        tenantId: movement.tenantId,
        userId: movement.userId,
        type: movement.type,
        category: movement.category,
        amount: movement.amount.toDecimalString(),
        reference: movement.reference,
        description: movement.description,
        date: movement.date,
      },
    });
    return this.toDomain(row);
  }

  async findMany(tenantId: UUID, query: CashMovementQuery): Promise<PaginatedResult<CashMovement>> {
    const where = this.buildWhere(tenantId, query.filters);
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.cashMovement.findMany({
        where,
        orderBy: DEFAULT_ORDER_BY,
        skip,
        take: query.pageSize,
      }),
      this.prisma.cashMovement.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async sumByCash(tenantId: UUID, cashId: UUID, currency: string): Promise<Money> {
    // The `type` column encodes direction, so a DB-side sum cannot net INCOME
    // against EXPENSE directly. We read the register's movements and fold them
    // with integer-safe Money math, preserving the sign conventions.
    const rows = await this.prisma.cashMovement.findMany({ where: { tenantId, cashId } });
    let total = Money.zero(currency);
    for (const row of rows) {
      const type = assertCashMovementType(row.type);
      const amount = Money.fromDecimal(row.amount.toString(), currency);
      total = total.add(amount.multiply(cashMovementDelta(type)));
    }
    return total;
  }

  private buildWhere(
    tenantId: UUID,
    filters: CashMovementFilters | undefined,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId };
    if (filters === undefined) {
      return where;
    }
    if (filters.cashId !== undefined) {
      where.cashId = filters.cashId;
    }
    if (filters.type !== undefined) {
      where.type = filters.type;
    }
    if (filters.category !== undefined) {
      where.category = filters.category;
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

  private toDomain(row: CashMovementRow): CashMovement {
    return CashMovement.reconstitute(row.id, {
      cashId: row.cashId,
      tenantId: row.tenantId,
      userId: row.userId,
      type: assertCashMovementType(row.type),
      category: assertCashMovementCategory(row.category),
      amount: Money.fromDecimal(row.amount.toString(), this.currency),
      reference: row.reference as Nullable<string>,
      description: row.description as Nullable<string>,
      date: row.date,
    });
  }
}
