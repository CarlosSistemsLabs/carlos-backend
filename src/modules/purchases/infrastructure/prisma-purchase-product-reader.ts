import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { DecimalLike } from './prisma-purchase-repository.js';
import type {
  IPurchaseProductReader,
  ProductCost,
} from '../domain/ports/purchase-product-reader.js';

/** The columns the reader projects from a `Product` row. */
export interface ProductCostRow {
  id: string;
  /** `Product.cost` is nullable in the schema. */
  cost: DecimalLike | null;
  taxRate: DecimalLike;
}

/** Minimal `product` delegate surface used by {@link PrismaPurchaseProductReader}. */
export interface ProductCostDelegate {
  findFirst(args: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<ProductCostRow | null>;
}

/** A Prisma-like client exposing (at least) the `product` delegate. */
export interface PurchaseProductReaderPrismaClient {
  product: ProductCostDelegate;
}

/**
 * Prisma-backed {@link IPurchaseProductReader}.
 *
 * Implements the Purchases-owned cost port against the shared `Product` table
 * (Dependency Inversion — Purchases does not import the Products module
 * internals). Reads the **cost** column (not the sale price), excludes
 * soft-deleted products and scopes by `tenantId` for defence-in-depth
 * (Requirement 1.5). `cost` is a bare, nullable `Decimal` with no currency
 * column: it is rehydrated into {@link Money} using the configured tenant
 * currency when present, and surfaced as `null` when the product has no
 * recorded cost (the use case then falls back to a client-supplied override).
 */
export class PrismaPurchaseProductReader implements IPurchaseProductReader {
  constructor(
    private readonly prisma: PurchaseProductReaderPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async findCost(tenantId: UUID, productId: UUID): Promise<ProductCost | null> {
    const row = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
      select: { id: true, cost: true, taxRate: true },
    });
    if (row === null) {
      return null;
    }
    return {
      productId: row.id,
      unitCost: row.cost === null ? null : Money.fromDecimal(row.cost.toString(), this.currency),
      taxRate: Number(row.taxRate.toString()),
    };
  }
}
