import type { Nullable, UUID } from '@shared/types/index.js';
import type {
  IStockReportReader,
  StockLevelItem,
  StockReportData,
  StockReportFilters,
} from '../domain/ports/stock-report-reader.js';

/** The product columns joined onto each stock row. */
export interface StockReportProductRow {
  name: string;
  sku: string;
  minStock: number;
}

/** A stock row projected with its joined product threshold. */
export interface StockReportRow {
  productId: string;
  branchId: string | null;
  quantity: number;
  product: StockReportProductRow;
}

/** Minimal `stock` delegate surface used by the reader. */
export interface StockReportDelegate {
  findMany(args: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<StockReportRow[]>;
}

/** A Prisma-like client exposing the `stock` delegate. */
export interface StockReportPrismaClient {
  stock: StockReportDelegate;
}

/**
 * Prisma-backed {@link IStockReportReader}.
 *
 * Reads stock levels joined to their product (`name`/`sku`/`minStock`) with a
 * single `stock.findMany`, scoped by `tenantId` and excluding soft-deleted
 * products. Low stock (`quantity <= minStock`) is a **two-column comparison**
 * Prisma cannot express in a `where` clause without raw SQL, so the flag is
 * computed here and the low-stock subset derived in the same pass (raw-SQL/index
 * tuning is deferred to task 25.2).
 */
export class PrismaStockReportReader implements IStockReportReader {
  constructor(private readonly prisma: StockReportPrismaClient) {}

  async stockLevels(tenantId: UUID, filters: StockReportFilters): Promise<StockReportData> {
    const where: Record<string, unknown> = {
      tenantId,
      product: { deletedAt: null },
    };
    if (filters.branchId !== undefined) {
      where.branchId = filters.branchId;
    }

    const rows = await this.prisma.stock.findMany({
      where,
      select: {
        productId: true,
        branchId: true,
        quantity: true,
        product: { select: { name: true, sku: true, minStock: true } },
      },
      orderBy: { quantity: 'asc' },
    });

    const items = rows.map((row) => this.toItem(row));
    const lowStock = items.filter((item) => item.isLowStock);

    return {
      items,
      lowStock,
      totalItems: items.length,
      lowStockCount: lowStock.length,
    };
  }

  private toItem(row: StockReportRow): StockLevelItem {
    return {
      productId: row.productId,
      productName: row.product.name,
      sku: row.product.sku,
      branchId: row.branchId as Nullable<UUID>,
      quantity: row.quantity,
      minStock: row.product.minStock,
      isLowStock: row.quantity <= row.product.minStock,
    };
  }
}
