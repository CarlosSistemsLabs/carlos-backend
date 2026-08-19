import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { DecimalLike } from './prisma-sale-repository.js';
import type { ISaleProductReader, ProductPricing } from '../domain/ports/sale-product-reader.js';

/** The columns the reader projects from a `Product` row. */
export interface ProductPricingRow {
  id: string;
  price: DecimalLike;
  taxRate: DecimalLike;
}

/** Minimal `product` delegate surface used by {@link PrismaSaleProductReader}. */
export interface ProductPricingDelegate {
  findFirst(args: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<ProductPricingRow | null>;
}

/** A Prisma-like client exposing (at least) the `product` delegate. */
export interface SaleProductReaderPrismaClient {
  product: ProductPricingDelegate;
}

/**
 * Prisma-backed {@link ISaleProductReader}.
 *
 * Implements the Sales-owned pricing port against the shared `Product` table
 * (Dependency Inversion — Sales does not import the Products module internals).
 * Excludes soft-deleted products and scopes by `tenantId` for defence-in-depth
 * (Requirement 1.5). `price` is a bare `Decimal` with no currency column, so it
 * is rehydrated into {@link Money} using the configured tenant currency.
 */
export class PrismaSaleProductReader implements ISaleProductReader {
  constructor(
    private readonly prisma: SaleProductReaderPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async findPricing(tenantId: UUID, productId: UUID): Promise<ProductPricing | null> {
    const row = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
      select: { id: true, price: true, taxRate: true },
    });
    if (row === null) {
      return null;
    }
    return {
      productId: row.id,
      unitPrice: Money.fromDecimal(row.price.toString(), this.currency),
      taxRate: Number(row.taxRate.toString()),
    };
  }
}
