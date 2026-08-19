import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListProductsUseCase } from './list-products.use-case.js';
import { Product } from '../../domain/entities/product.js';
import { Money } from '../../domain/value-objects/money.js';
import { Sku } from '../../domain/value-objects/sku.js';
import type {
  IProductRepository,
  ProductQuery,
} from '../../domain/repositories/product-repository.js';
import type { PaginatedResult } from '@shared/types/index.js';

function product(id: string, name: string): Product {
  return Product.reconstitute(id, {
    tenantId: 'tenant-1',
    categoryId: 'cat-1',
    sku: Sku.create(id),
    name,
    description: null,
    price: Money.fromDecimal('10.00', 'ARS'),
    cost: null,
    taxRate: 0,
    unit: 'unit',
    minStock: 0,
    isActive: true,
    imageUrl: null,
  });
}

function page(items: Product[], total: number, p: number, ps: number): PaginatedResult<Product> {
  return { items, total, page: p, pageSize: ps, totalPages: total === 0 ? 0 : Math.ceil(total / ps) };
}

function makeProducts(result: PaginatedResult<Product>): IProductRepository {
  return {
    findById: vi.fn(),
    findBySku: vi.fn(),
    findMany: vi.fn().mockResolvedValue(result),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsBySku: vi.fn(),
  };
}

describe('ListProductsUseCase', () => {
  let products: IProductRepository;
  let useCase: ListProductsUseCase;

  beforeEach(() => {
    products = makeProducts(page([product('P1', 'Apple'), product('P2', 'Banana')], 2, 1, 20));
    useCase = new ListProductsUseCase(products);
  });

  it('returns a paginated envelope with projected items and meta', async () => {
    const result = await useCase.execute({ tenantId: 'tenant-1' });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.name).toBe('Apple');
    expect(result.meta).toEqual({ total: 2, page: 1, pageSize: 20, totalPages: 1 });
  });

  it('applies the default page size of 20 when none is supplied', async () => {
    await useCase.execute({ tenantId: 'tenant-1' });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.pageSize).toBe(20);
    expect(query.page).toBe(1);
  });

  it('clamps an over-large page size to the maximum of 100', async () => {
    await useCase.execute({ tenantId: 'tenant-1', pageSize: 5000 });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.pageSize).toBe(100);
  });

  it('clamps a sub-1 page size up to the minimum of 1 and a sub-1 page up to 1', async () => {
    await useCase.execute({ tenantId: 'tenant-1', page: 0, pageSize: 0 });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.pageSize).toBe(1);
    expect(query.page).toBe(1);
  });

  it('forwards category and isActive filters to the repository', async () => {
    await useCase.execute({ tenantId: 'tenant-1', categoryId: 'cat-9', isActive: false });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.filters).toEqual({ categoryId: 'cat-9', isActive: false });
  });

  it('passes sort options through when provided', async () => {
    await useCase.execute({ tenantId: 'tenant-1', sortBy: 'price', sortDirection: 'desc' });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.sort).toEqual({ field: 'price', direction: 'desc' });
  });

  it('omits sort when no sortBy is supplied', async () => {
    await useCase.execute({ tenantId: 'tenant-1' });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.sort).toBeUndefined();
  });
});
