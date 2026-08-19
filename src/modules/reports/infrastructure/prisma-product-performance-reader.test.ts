import { describe, it, expect, vi } from 'vitest';
import {
  PrismaProductPerformanceReader,
  type ProductPerformancePrismaClient,
  type ProductNameRow,
  type SaleDetailGroupRow,
} from './prisma-product-performance-reader.js';

const CURRENCY = 'ARS';

function makeClient(
  groups: SaleDetailGroupRow[],
  products: ProductNameRow[],
): {
  client: ProductPerformancePrismaClient;
  groupBy: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
} {
  const groupBy = vi.fn(async () => groups);
  const findMany = vi.fn(async () => products);
  return {
    client: {
      saleDetail: { groupBy },
      product: { findMany },
    } as unknown as ProductPerformancePrismaClient,
    groupBy,
    findMany,
  };
}

describe('PrismaProductPerformanceReader', () => {
  const from = new Date('2024-01-01T00:00:00.000Z');
  const to = new Date('2024-01-31T23:59:59.999Z');

  it('ranks by summed quantity desc with a top-N take, scoping via the sale relation', async () => {
    const { client, groupBy } = makeClient([], []);

    await new PrismaProductPerformanceReader(client, CURRENCY).productPerformance('t1', {
      from,
      to,
      limit: 5,
    });

    const args = groupBy.mock.calls[0]![0];
    expect(args.by).toEqual(['productId']);
    expect(args._sum).toEqual({ quantity: true, total: true });
    expect(args.orderBy).toEqual({ _sum: { quantity: 'desc' } });
    expect(args.take).toBe(5);
    // SaleDetail has no tenantId column — scope is applied through the sale relation.
    expect(args.where).toEqual({
      sale: {
        tenantId: 't1',
        deletedAt: null,
        status: 'completed',
        saleDate: { gte: from, lte: to },
      },
    });
  });

  it('resolves product name/sku and maps revenue to Money', async () => {
    const { client, findMany } = makeClient(
      [
        { productId: 'p1', _sum: { quantity: 42, total: '1234.50' } },
        { productId: 'p2', _sum: { quantity: 7, total: '70.00' } },
      ],
      [
        { id: 'p1', name: 'Widget', sku: 'SKU-1' },
        { id: 'p2', name: 'Gadget', sku: 'SKU-2' },
      ],
    );

    const result = await new PrismaProductPerformanceReader(client, CURRENCY).productPerformance(
      't1',
      { from, to, limit: 10 },
    );

    expect(findMany.mock.calls[0]![0].where).toEqual({
      tenantId: 't1',
      id: { in: ['p1', 'p2'] },
    });
    expect(result.products[0]).toMatchObject({
      productId: 'p1',
      productName: 'Widget',
      sku: 'SKU-1',
      quantitySold: 42,
    });
    expect(result.products[0]!.revenue.toDecimalString()).toBe('1234.50');
  });

  it('defaults missing product metadata and null sums', async () => {
    const { client } = makeClient(
      [{ productId: 'p1', _sum: { quantity: null, total: null } }],
      [],
    );

    const result = await new PrismaProductPerformanceReader(client, CURRENCY).productPerformance(
      't1',
      { from, to, limit: 10 },
    );

    expect(result.products[0]).toMatchObject({ productName: '', sku: '', quantitySold: 0 });
    expect(result.products[0]!.revenue.toDecimalString()).toBe('0.00');
  });

  it('short-circuits the product lookup when there are no groups', async () => {
    const { client, findMany } = makeClient([], []);

    const result = await new PrismaProductPerformanceReader(client, CURRENCY).productPerformance(
      't1',
      { from, to, limit: 10 },
    );

    expect(result.products).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
