import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchProductsUseCase } from './search-products.use-case.js';
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

describe('SearchProductsUseCase', () => {
  let products: IProductRepository;
  let useCase: SearchProductsUseCase;

  beforeEach(() => {
    products = makeProducts({
      items: [product('COLA-1', 'Cola 1L')],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    useCase = new SearchProductsUseCase(products);
  });

  it('passes a trimmed search term as a filter and returns a paginated envelope', async () => {
    const result = await useCase.execute({ tenantId: 'tenant-1', term: '  cola ' });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.filters?.search).toBe('cola');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Cola 1L');
    expect(result.meta.total).toBe(1);
  });

  it('degrades to an unfiltered listing when the term is blank', async () => {
    await useCase.execute({ tenantId: 'tenant-1', term: '   ' });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.filters?.search).toBeUndefined();
  });

  it('clamps the page size to the maximum of 100', async () => {
    await useCase.execute({ tenantId: 'tenant-1', term: 'cola', pageSize: 999 });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.pageSize).toBe(100);
  });

  it('combines the search term with category and active filters', async () => {
    await useCase.execute({
      tenantId: 'tenant-1',
      term: 'cola',
      categoryId: 'cat-3',
      isActive: true,
    });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.filters).toEqual({ search: 'cola', categoryId: 'cat-3', isActive: true });
  });
});
