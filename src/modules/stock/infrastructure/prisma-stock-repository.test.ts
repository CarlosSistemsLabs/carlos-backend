import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaStockRepository,
  type StockPrismaClient,
  type StockRow,
  type StockRowWithProduct,
} from './prisma-stock-repository.js';
import { Stock } from '../domain/entities/stock.js';

function stockRow(overrides: Partial<StockRow> = {}): StockRow {
  return {
    id: 'stock-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    branchId: 'branch-1',
    quantity: 7,
    ...overrides,
  };
}

function rowWithProduct(overrides: Partial<StockRowWithProduct> = {}): StockRowWithProduct {
  return {
    ...stockRow(),
    product: { name: 'Cola 1L', minStock: 5 },
    ...overrides,
  };
}

function makeClient(): StockPrismaClient {
  return {
    stock: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn(async () => stockRow()),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

describe('PrismaStockRepository', () => {
  let client: StockPrismaClient;
  let repo: PrismaStockRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaStockRepository(client);
  });

  it('maps a persistence row to a Stock aggregate on findByProductBranch', async () => {
    vi.mocked(client.stock.findFirst).mockResolvedValue(stockRow());
    const stock = await repo.findByProductBranch('tenant-1', 'prod-1', 'branch-1');

    expect(client.stock.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', productId: 'prod-1', branchId: 'branch-1' },
    });
    expect(stock?.id).toBe('stock-1');
    expect(stock?.quantity).toBe(7);
    expect(stock?.branchId).toBe('branch-1');
  });

  it('queries the tenant-wide balance with branchId null', async () => {
    await repo.findByProductBranch('tenant-1', 'prod-1', null);
    expect(client.stock.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', productId: 'prod-1', branchId: null },
    });
  });

  it('upserts by id: inserts full state, updates quantity only', async () => {
    const stock = Stock.reconstitute('stock-1', {
      tenantId: 'tenant-1',
      productId: 'prod-1',
      branchId: 'branch-1',
      quantity: 12,
    });
    await repo.save(stock);

    expect(client.stock.upsert).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      create: {
        id: 'stock-1',
        tenantId: 'tenant-1',
        productId: 'prod-1',
        branchId: 'branch-1',
        quantity: 12,
      },
      update: { quantity: 12 },
    });
  });

  it('builds a stock-level page joining product name/minStock with pagination meta', async () => {
    vi.mocked(client.stock.findMany).mockResolvedValue([rowWithProduct()]);
    vi.mocked(client.stock.count).mockResolvedValue(1);

    const result = await repo.findByTenant('tenant-1', {
      page: 2,
      pageSize: 10,
      filters: { productId: 'prod-1' },
    });

    const findArgs = vi.mocked(client.stock.findMany).mock.calls[0]![0];
    expect(findArgs.where).toEqual({ tenantId: 'tenant-1', productId: 'prod-1' });
    expect(findArgs.skip).toBe(10);
    expect(findArgs.take).toBe(10);
    expect(findArgs.include).toEqual({ product: { select: { name: true, minStock: true } } });

    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ productName: 'Cola 1L', minStock: 5 });
    expect(result.items[0]?.stock.quantity).toBe(7);
  });

  it('runs a parameterised raw query for low stock and maps the rows', async () => {
    vi.mocked(client.$queryRaw)
      .mockResolvedValueOnce([
        {
          id: 'stock-1',
          tenantId: 'tenant-1',
          productId: 'prod-1',
          branchId: null,
          quantity: 1,
          productName: 'Cola 1L',
          minStock: 5,
        },
      ])
      .mockResolvedValueOnce([{ count: 1 }]);

    const result = await repo.findLowStock('tenant-1', {
      page: 1,
      pageSize: 20,
      filters: { branchId: null },
    });

    const rowsCall = vi.mocked(client.$queryRaw).mock.calls[0]!;
    // The query is passed as a Prisma.sql fragment, NOT a plain string: static
    // predicates appear in the parameterised SQL text and values are bound.
    const fragment = rowsCall[0] as unknown as { sql: string; values: unknown[] };
    expect(fragment.sql).toContain('s.quantity <= p."minStock"');
    expect(fragment.sql).toContain('s."branchId" IS NULL');
    // First bound parameter is always the tenant id (defence-in-depth scoping).
    expect(fragment.values[0]).toBe('tenant-1');
    // Trailing bound params are the LIMIT and OFFSET.
    expect(fragment.values.slice(-2)).toEqual([20, 0]);

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ productName: 'Cola 1L', minStock: 5 });
    expect(result.items[0]?.stock.isLow(5)).toBe(true);
  });
});
