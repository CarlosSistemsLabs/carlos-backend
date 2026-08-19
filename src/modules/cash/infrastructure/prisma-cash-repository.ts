import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import { Cash } from '../domain/entities/cash.js';
import type {
  CashFilters,
  CashQuery,
  ICashRepository,
} from '../domain/repositories/cash-repository.js';

/**
 * Anything that stringifies to a decimal — covers Prisma's `Decimal` runtime
 * type as well as plain `number`/`string` values used in tests. Keeping the
 * mapper structural lets the repository be exercised with trivial fake
 * delegates.
 */
export interface DecimalLike {
  toString(): string;
}

/** Persistence row for a `Cash` register (structural subset of Prisma's type). */
export interface CashRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  balance: DecimalLike;
}

/** Arguments accepted by the `cash` delegate's read methods. */
export interface CashFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** Minimal `cash` delegate surface used by {@link PrismaCashRepository}. */
export interface CashModelDelegate {
  findFirst(args: CashFindArgs): Promise<CashRow | null>;
  findMany(args: CashFindArgs): Promise<CashRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<CashRow>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<CashRow>;
}

/** A Prisma-like client exposing (at least) the `cash` delegate. */
export interface CashPrismaClient {
  cash: CashModelDelegate;
}

/** Registers are listed by name ascending by default. */
const DEFAULT_ORDER_BY = { name: 'asc' } as const;

/**
 * Prisma-backed {@link ICashRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant. Methods still
 * apply `tenantId` explicitly for defence-in-depth (Requirement 1.5).
 *
 * **Money ⇄ Decimal mapping:** `Cash.balance` is a bare `Decimal` column with no
 * currency, so {@link Money} is rehydrated using a configured currency
 * (defaulting to the tenant base currency). Writes use {@link
 * Money.toDecimalString} so the stored value matches the value object exactly.
 *
 * The `Cash` model has no soft-delete column, so there is no delete method.
 */
export class PrismaCashRepository implements ICashRepository {
  constructor(
    private readonly prisma: CashPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async findById(id: UUID): Promise<Cash | null> {
    const row = await this.prisma.cash.findFirst({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  async findByTenant(tenantId: UUID, query: CashQuery): Promise<PaginatedResult<Cash>> {
    const where = this.buildWhere(tenantId, query.filters);
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.cash.findMany({ where, orderBy: DEFAULT_ORDER_BY, skip, take: query.pageSize }),
      this.prisma.cash.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async create(cash: Cash): Promise<Cash> {
    const row = await this.prisma.cash.create({
      data: {
        id: cash.id,
        tenantId: cash.tenantId,
        branchId: cash.branchId,
        name: cash.name,
        balance: cash.balance.toDecimalString(),
      },
    });
    return this.toDomain(row);
  }

  async updateBalance(id: UUID, balance: Money): Promise<void> {
    await this.prisma.cash.update({
      where: { id },
      data: { balance: balance.toDecimalString() },
    });
  }

  async save(cash: Cash): Promise<Cash> {
    const row = await this.prisma.cash.update({
      where: { id: cash.id },
      data: {
        branchId: cash.branchId,
        name: cash.name,
        balance: cash.balance.toDecimalString(),
      },
    });
    return this.toDomain(row);
  }

  private buildWhere(tenantId: UUID, filters: CashFilters | undefined): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.branchId !== undefined) {
      where.branchId = filters.branchId;
    }
    return where;
  }

  private toDomain(row: CashRow): Cash {
    return Cash.reconstitute(row.id, {
      tenantId: row.tenantId,
      branchId: row.branchId as Nullable<UUID>,
      name: row.name,
      balance: Money.fromDecimal(row.balance.toString(), this.currency),
      currency: this.currency,
    });
  }
}
