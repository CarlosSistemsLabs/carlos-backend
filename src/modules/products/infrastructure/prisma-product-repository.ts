import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { Product } from '../domain/entities/product.js';
import { Sku } from '../domain/value-objects/sku.js';
import { Money } from '../domain/value-objects/money.js';
import type {
  IProductRepository,
  ProductFilters,
  ProductQuery,
  ProductSort,
} from '../domain/repositories/product-repository.js';

/**
 * Anything that stringifies to a decimal — covers Prisma's `Decimal` runtime
 * type as well as plain `number`/`string` values used in tests. Keeping the
 * mapper structural (rather than importing `Prisma.Decimal`) lets the
 * repository be exercised with a trivial fake delegate.
 */
export interface DecimalLike {
  toString(): string;
}

/**
 * Persistence row shape for the `Product` model. A structural subset of the
 * generated Prisma type so the Money ⇄ Decimal mapping stays explicit and the
 * repository remains trivially testable with a fake delegate.
 */
export interface ProductRow {
  id: string;
  tenantId: string;
  categoryId: string;
  sku: string;
  name: string;
  description: string | null;
  price: DecimalLike;
  cost: DecimalLike | null;
  taxRate: DecimalLike;
  unit: string;
  minStock: number;
  isActive: boolean;
  imageUrl: string | null;
}

/** Arguments accepted by the `product` delegate's read/write methods. */
export interface ProductFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** Minimal `product` delegate surface used by {@link PrismaProductRepository}. */
export interface ProductModelDelegate {
  findFirst(args: ProductFindArgs): Promise<ProductRow | null>;
  findMany(args: ProductFindArgs): Promise<ProductRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<ProductRow>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<ProductRow>;
}

/** A Prisma-like client exposing (at least) the `product` delegate. */
export interface ProductPrismaClient {
  product: ProductModelDelegate;
}

/** Default ordering applied when a query omits an explicit sort. */
const DEFAULT_SORT: ProductSort = { field: 'name', direction: 'asc' };

/**
 * Prisma-backed {@link IProductRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on every query.
 * Methods still receive `tenantId` explicitly and apply it to the `where`
 * clause for defence-in-depth and so the repository behaves correctly even when
 * invoked outside a request context (Requirement 1.5).
 *
 * **Money ⇄ Decimal mapping:** the `Product` table stores `price`/`cost` as
 * bare `Decimal` columns with no currency, so {@link Money} is rehydrated using
 * a configured currency (defaulting to the tenant base currency). Writes use
 * {@link Money.toDecimalString} so the stored value matches the value object
 * exactly with no floating-point drift.
 *
 * Soft-deleted rows (`deletedAt != null`) are excluded from every read
 * (Requirement 9.4); search uses a case-insensitive `contains` match.
 */
export class PrismaProductRepository implements IProductRepository {
  constructor(
    private readonly prisma: ProductPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async findById(id: UUID): Promise<Product | null> {
    const row = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    return row === null ? null : this.toDomain(row);
  }

  async findBySku(tenantId: UUID, sku: string): Promise<Product | null> {
    const row = await this.prisma.product.findFirst({
      where: { tenantId, sku: Sku.create(sku).value, deletedAt: null },
    });
    return row === null ? null : this.toDomain(row);
  }

  async findMany(tenantId: UUID, query: ProductQuery): Promise<PaginatedResult<Product>> {
    const where = this.buildWhere(tenantId, query.filters);
    const sort = query.sort ?? DEFAULT_SORT;
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { [sort.field]: sort.direction },
        skip,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async create(product: Product): Promise<Product> {
    const row = await this.prisma.product.create({
      data: { id: product.id, ...this.toPersistence(product) },
    });
    return this.toDomain(row);
  }

  async update(product: Product): Promise<Product> {
    const row = await this.prisma.product.update({
      where: { id: product.id },
      data: this.toPersistence(product),
    });
    return this.toDomain(row);
  }

  async softDelete(id: UUID): Promise<void> {
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async existsBySku(tenantId: UUID, sku: string, excludeId?: UUID): Promise<boolean> {
    const where: Record<string, unknown> = {
      tenantId,
      sku: Sku.create(sku).value,
      deletedAt: null,
    };
    if (excludeId !== undefined) {
      where.id = { not: excludeId };
    }
    const count = await this.prisma.product.count({ where });
    return count > 0;
  }

  /** Builds the `where` clause: tenant scope, soft-delete filter and filters. */
  private buildWhere(tenantId: UUID, filters: ProductFilters | undefined): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (filters === undefined) {
      return where;
    }
    if (filters.categoryId !== undefined) {
      where.categoryId = filters.categoryId;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.search !== undefined && filters.search.length > 0) {
      // Case-insensitive substring match across name and SKU. See
      // SearchProductsUseCase for how this is swapped for full-text search.
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /** Maps a persistence row to the {@link Product} aggregate. */
  private toDomain(row: ProductRow): Product {
    return Product.reconstitute(row.id, {
      tenantId: row.tenantId,
      categoryId: row.categoryId,
      sku: Sku.create(row.sku),
      name: row.name,
      description: row.description,
      price: Money.fromDecimal(row.price.toString(), this.currency),
      cost: row.cost === null ? null : Money.fromDecimal(row.cost.toString(), this.currency),
      taxRate: Number(row.taxRate.toString()),
      unit: row.unit,
      minStock: row.minStock,
      isActive: row.isActive,
      imageUrl: row.imageUrl,
    });
  }

  /** Maps a {@link Product} aggregate to a persistence payload. */
  private toPersistence(product: Product): Record<string, unknown> {
    return {
      tenantId: product.tenantId,
      categoryId: product.categoryId,
      sku: product.sku.value,
      name: product.name,
      description: product.description,
      price: product.price.toDecimalString(),
      cost: product.cost === null ? null : product.cost.toDecimalString(),
      taxRate: product.taxRate,
      unit: product.unit,
      minStock: product.minStock,
      isActive: product.isActive,
      imageUrl: product.imageUrl,
    };
  }
}
