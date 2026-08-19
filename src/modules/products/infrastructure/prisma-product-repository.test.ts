import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaProductRepository,
  type ProductPrismaClient,
  type ProductRow,
} from './prisma-product-repository.js';
import { Product } from '../domain/entities/product.js';
import { Money } from '../domain/value-objects/money.js';
import { Sku } from '../domain/value-objects/sku.js';

/**
 * A trivial Decimal stand-in mirroring Prisma's `Decimal` runtime contract:
 * the repository maps it to/from {@link Money} purely via `toString()`.
 */
function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function productRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'prod-1',
    tenantId: 'tenant-1',
    categoryId: 'cat-1',
    sku: 'ABC-1',
    name: 'Cola 1L',
    description: null,
    price: decimal('19.90'),
    cost: decimal('10.00'),
    taxRate: decimal('21.00'),
    unit: 'unit',
    minStock: 5,
    isActive: true,
    imageUrl: null,
    ...overrides,
  };
}

function makeClient(): ProductPrismaClient {
  return {
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async () => productRow()),
      update: vi.fn(async () => productRow()),
    },
  };
}

function sampleProduct(): Product {
  return Product.reconstitute('prod-1', {
    tenantId: 'tenant-1',
    categoryId: 'cat-1',
    sku: Sku.create('ABC-1'),
    name: 'Cola 1L',
    description: null,
    price: Money.fromDecimal('19.90', 'ARS'),
    cost: Money.fromDecimal('10.00', 'ARS'),
    taxRate: 21,
    unit: 'unit',
    minStock: 5,
    isActive: true,
    imageUrl: null,
  });
}

describe('PrismaProductRepository', () => {
  let client: ProductPrismaClient;
  let repo: PrismaProductRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaProductRepository(client, 'ARS');
  });

  it('maps a Decimal persistence row to a Money-bearing domain aggregate', async () => {
    vi.mocked(client.product.findFirst).mockResolvedValue(productRow());
    const product = await repo.findById('prod-1');

    expect(product).not.toBeNull();
    expect(product?.price.toDecimalString()).toBe('19.90');
    expect(product?.price.currency).toBe('ARS');
    expect(product?.cost?.toDecimalString()).toBe('10.00');
    expect(product?.taxRate).toBe(21);
    expect(product?.sku.value).toBe('ABC-1');
  });

  it('maps a null cost column to a null Money', async () => {
    vi.mocked(client.product.findFirst).mockResolvedValue(productRow({ cost: null }));
    const product = await repo.findById('prod-1');
    expect(product?.cost).toBeNull();
  });

  it('serialises Money to decimal strings when persisting', async () => {
    await repo.create(sampleProduct());
    const data = vi.mocked(client.product.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      id: 'prod-1',
      tenantId: 'tenant-1',
      sku: 'ABC-1',
      price: '19.90',
      cost: '10.00',
      taxRate: 21,
    });
  });

  it('excludes soft-deleted rows and scopes by tenant on findBySku', async () => {
    await repo.findBySku('tenant-1', 'abc-1');
    expect(client.product.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', sku: 'ABC-1', deletedAt: null },
    });
  });

  it('stamps deletedAt on soft delete', async () => {
    await repo.softDelete('prod-1');
    const args = vi.mocked(client.product.update).mock.calls[0]![0];
    expect(args.where).toEqual({ id: 'prod-1' });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('builds a case-insensitive name/SKU search with pagination and returns meta', async () => {
    vi.mocked(client.product.findMany).mockResolvedValue([productRow()]);
    vi.mocked(client.product.count).mockResolvedValue(1);

    const result = await repo.findMany('tenant-1', {
      page: 2,
      pageSize: 10,
      filters: { search: 'cola', isActive: true },
      sort: { field: 'price', direction: 'desc' },
    });

    const findArgs = vi.mocked(client.product.findMany).mock.calls[0]![0];
    expect(findArgs.where).toEqual({
      tenantId: 'tenant-1',
      deletedAt: null,
      isActive: true,
      OR: [
        { name: { contains: 'cola', mode: 'insensitive' } },
        { sku: { contains: 'cola', mode: 'insensitive' } },
      ],
    });
    expect(findArgs.skip).toBe(10);
    expect(findArgs.take).toBe(10);
    expect(findArgs.orderBy).toEqual({ price: 'desc' });
    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10, totalPages: 1 });
    expect(result.items).toHaveLength(1);
  });

  it('excludes a given id when checking SKU existence (for updates)', async () => {
    vi.mocked(client.product.count).mockResolvedValue(0);
    const exists = await repo.existsBySku('tenant-1', 'abc-1', 'prod-1');
    expect(client.product.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', sku: 'ABC-1', deletedAt: null, id: { not: 'prod-1' } },
    });
    expect(exists).toBe(false);
  });
});
