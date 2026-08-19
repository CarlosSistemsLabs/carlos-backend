import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type {
  IProductPerformanceReader,
  ProductPerformanceData,
  ProductPerformanceFilters,
  ProductPerformanceItem,
} from '../domain/ports/product-performance-reader.js';

/** Anything that stringifies to a decimal (Prisma `Decimal`, number or string). */
export interface DecimalLike {
  toString(): string;
}

/** A `saleDetail.groupBy` row grouped by `productId`. */
export interface SaleDetailGroupRow {
  productId: string;
  _sum: { quantity: number | null; total: DecimalLike | null };
}

/** A projected `product` name/sku row. */
export interface ProductNameRow {
  id: string;
  name: string;
  sku: string;
}

/** Minimal `saleDetail` + `product` delegate surface used by the reader. */
export interface ProductPerformancePrismaClient {
  saleDetail: {
    groupBy(args: {
      by: ['productId'];
      where?: Record<string, unknown>;
      _sum: { quantity: true; total: true };
      orderBy?: Record<string, unknown>;
      take?: number;
    }): Promise<SaleDetailGroupRow[]>;
  };
  product: {
    findMany(args: {
      where?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<ProductNameRow[]>;
  };
}

const COMPLETED_STATUS = 'completed';

/**
 * Prisma-backed {@link IProductPerformanceReader}.
 *
 * Ranks products with a single `saleDetail.groupBy` on `productId`
 * (`_sum.quantity` desc, `take: limit`). `SaleDetail` has no `tenantId` column,
 * so the tenant/date/status scope is applied through the `sale` relation
 * (`sale: { tenantId, deletedAt: null, status, saleDate }`). A second
 * `product.findMany` resolves display `name`/`sku` for just the ranked ids
 * (avoiding importing the Products module). Revenue is the summed detail `total`
 * rehydrated into {@link Money}.
 */
export class PrismaProductPerformanceReader implements IProductPerformanceReader {
  constructor(
    private readonly prisma: ProductPerformancePrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async productPerformance(
    tenantId: UUID,
    filters: ProductPerformanceFilters,
  ): Promise<ProductPerformanceData> {
    const groups = await this.prisma.saleDetail.groupBy({
      by: ['productId'],
      where: {
        sale: {
          tenantId,
          deletedAt: null,
          status: COMPLETED_STATUS,
          saleDate: { gte: filters.from, lte: filters.to },
        },
      },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: filters.limit,
    });

    if (groups.length === 0) {
      return { products: [] };
    }

    const products = await this.prisma.product.findMany({
      where: { tenantId, id: { in: groups.map((group) => group.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const productById = new Map(products.map((row) => [row.id, row]));

    const items: ProductPerformanceItem[] = groups.map((group) => {
      const product = productById.get(group.productId);
      return {
        productId: group.productId,
        productName: product?.name ?? '',
        sku: product?.sku ?? '',
        quantitySold: group._sum.quantity ?? 0,
        revenue:
          group._sum.total === null
            ? Money.zero(this.currency)
            : Money.fromDecimal(group._sum.total.toString(), this.currency),
      };
    });

    return { products: items };
  }
}
