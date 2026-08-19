import { describe, it, expect, vi } from 'vitest';
import {
  PrismaStockReportReader,
  type StockReportPrismaClient,
  type StockReportRow,
} from './prisma-stock-report-reader.js';

function makeClient(rows: StockReportRow[]): {
  client: StockReportPrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => rows);
  return { client: { stock: { findMany } } as unknown as StockReportPrismaClient, findMany };
}

function row(overrides: Partial<StockReportRow> = {}): StockReportRow {
  return {
    productId: 'p1',
    branchId: null,
    quantity: 5,
    product: { name: 'Widget', sku: 'SKU-1', minStock: 10 },
    ...overrides,
  };
}

describe('PrismaStockReportReader', () => {
  it('scopes by tenant, excludes deleted products and applies the branch filter', async () => {
    const { client, findMany } = makeClient([]);

    await new PrismaStockReportReader(client).stockLevels('t1', { branchId: 'b1' });

    const args = findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ tenantId: 't1', product: { deletedAt: null }, branchId: 'b1' });
    expect(args.select).toMatchObject({
      productId: true,
      branchId: true,
      quantity: true,
      product: { select: { name: true, sku: true, minStock: true } },
    });
  });

  it('flags low stock when quantity is at or below minStock and derives the subset', async () => {
    const { client } = makeClient([
      row({ productId: 'p1', quantity: 2, product: { name: 'A', sku: 'S1', minStock: 10 } }),
      row({ productId: 'p2', quantity: 10, product: { name: 'B', sku: 'S2', minStock: 10 } }),
      row({ productId: 'p3', quantity: 99, product: { name: 'C', sku: 'S3', minStock: 10 } }),
    ]);

    const result = await new PrismaStockReportReader(client).stockLevels('t1', {});

    expect(result.totalItems).toBe(3);
    expect(result.lowStockCount).toBe(2); // p1 (below) and p2 (equal)
    expect(result.items.map((i) => i.isLowStock)).toEqual([true, true, false]);
    expect(result.lowStock.map((i) => i.productId)).toEqual(['p1', 'p2']);
    expect(result.items[0]).toMatchObject({
      productId: 'p1',
      productName: 'A',
      sku: 'S1',
      quantity: 2,
      minStock: 10,
    });
  });

  it('returns empty structures when there is no stock', async () => {
    const { client } = makeClient([]);

    const result = await new PrismaStockReportReader(client).stockLevels('t1', {});

    expect(result).toEqual({ items: [], lowStock: [], totalItems: 0, lowStockCount: 0 });
  });
});
