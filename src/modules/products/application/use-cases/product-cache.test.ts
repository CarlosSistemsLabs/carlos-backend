import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICache } from '@application/ports/cache.js';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { ListProductsUseCase } from './list-products.use-case.js';
import { SearchProductsUseCase } from './search-products.use-case.js';
import { CreateProductUseCase } from './create-product.use-case.js';
import { UpdateProductUseCase } from './update-product.use-case.js';
import { DeleteProductUseCase } from './delete-product.use-case.js';
import { Product } from '../../domain/entities/product.js';
import { Money } from '../../domain/value-objects/money.js';
import { Sku } from '../../domain/value-objects/sku.js';
import { Category } from '../../domain/entities/category.js';
import type {
  IProductRepository,
  ProductQuery,
} from '../../domain/repositories/product-repository.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import type { PaginatedResult } from '@shared/types/index.js';

const TENANT = 'tenant-1';

function product(id: string, name: string): Product {
  return Product.reconstitute(id, {
    tenantId: TENANT,
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

function pageOf(items: Product[]): PaginatedResult<Product> {
  return { items, total: items.length, page: 1, pageSize: 20, totalPages: 1 };
}

function makeProducts(result: PaginatedResult<Product>): IProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(product('P1', 'Apple')),
    findBySku: vi.fn(),
    findMany: vi.fn().mockResolvedValue(result),
    create: vi.fn(async (p: Product) => p),
    update: vi.fn(async (p: Product) => p),
    softDelete: vi.fn().mockResolvedValue(undefined),
    existsBySku: vi.fn().mockResolvedValue(false),
  };
}

function makeCategories(): ICategoryRepository {
  return {
    findById: vi.fn().mockResolvedValue(
      Category.reconstitute('cat-1', {
        tenantId: TENANT,
        name: 'Drinks',
        description: null,
        parentId: null,
      }),
    ),
    findByTenant: vi.fn().mockResolvedValue([]),
    findChildren: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
}

describe('ListProductsUseCase caching', () => {
  let products: IProductRepository;
  let cache: InMemoryCache;

  beforeEach(() => {
    products = makeProducts(pageOf([product('P1', 'Apple')]));
    cache = new InMemoryCache();
  });

  it('serves a repeated identical listing from cache (repo hit once)', async () => {
    const useCase = new ListProductsUseCase(products, cache);
    await useCase.execute({ tenantId: TENANT, page: 1 });
    await useCase.execute({ tenantId: TENANT, page: 1 });
    expect(products.findMany).toHaveBeenCalledOnce();
  });

  it('treats different query params as distinct cache entries', async () => {
    const useCase = new ListProductsUseCase(products, cache);
    await useCase.execute({ tenantId: TENANT, page: 1 });
    await useCase.execute({ tenantId: TENANT, page: 2 });
    expect(products.findMany).toHaveBeenCalledTimes(2);
  });

  it('populates the cache honouring the configured TTL', async () => {
    let now = 1000;
    cache = new InMemoryCache(() => now);
    const useCase = new ListProductsUseCase(products, cache, 30);
    await useCase.execute({ tenantId: TENANT, page: 1 });
    now += 31_000;
    await useCase.execute({ tenantId: TENANT, page: 1 });
    expect(products.findMany).toHaveBeenCalledTimes(2);
  });

  it('still returns correct data when the cache read fails', async () => {
    const throwing: ICache = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      del: vi.fn().mockRejectedValue(new Error('down')),
    };
    const useCase = new ListProductsUseCase(products, throwing);
    const result = await useCase.execute({ tenantId: TENANT, page: 1 });
    expect(result.items[0]?.name).toBe('Apple');
    expect(products.findMany).toHaveBeenCalledOnce();
  });
});

describe('SearchProductsUseCase caching', () => {
  it('does not collide with a plain listing of the same pagination', async () => {
    const products = makeProducts(pageOf([product('P1', 'Apple')]));
    const cache = new InMemoryCache();
    const list = new ListProductsUseCase(products, cache);
    const search = new SearchProductsUseCase(products, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await search.execute({ tenantId: TENANT, term: '', page: 1 });

    // Distinct op discriminator → both hit the repository.
    expect(products.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('product mutations invalidate the cached lists', () => {
  let products: IProductRepository;
  let categories: ICategoryRepository;
  let cache: InMemoryCache;

  beforeEach(() => {
    products = makeProducts(pageOf([product('P1', 'Apple')]));
    categories = makeCategories();
    cache = new InMemoryCache();
  });

  it('create invalidates so the next listing is a miss', async () => {
    const list = new ListProductsUseCase(products, cache);
    const create = new CreateProductUseCase(products, categories, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await create.execute({
      tenantId: TENANT,
      categoryId: 'cat-1',
      sku: 'NEW-1',
      name: 'New',
      price: '5.00',
    });
    await list.execute({ tenantId: TENANT, page: 1 });

    expect(products.findMany).toHaveBeenCalledTimes(2);
  });

  it('update invalidates the cached listing', async () => {
    const list = new ListProductsUseCase(products, cache);
    const update = new UpdateProductUseCase(products, categories, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await update.execute({ id: 'P1', tenantId: TENANT, name: 'Renamed' });
    await list.execute({ tenantId: TENANT, page: 1 });

    expect(products.findMany).toHaveBeenCalledTimes(2);
  });

  it('delete invalidates the cached listing', async () => {
    const list = new ListProductsUseCase(products, cache);
    const del = new DeleteProductUseCase(products, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await del.execute({ id: 'P1', tenantId: TENANT });
    await list.execute({ tenantId: TENANT, page: 1 });

    expect(products.findMany).toHaveBeenCalledTimes(2);
  });

  it('only invalidates the mutating tenant, not others', async () => {
    const list = new ListProductsUseCase(products, cache);
    const create = new CreateProductUseCase(products, categories, cache);

    await list.execute({ tenantId: 'tenant-2', page: 1 });
    await create.execute({
      tenantId: TENANT,
      categoryId: 'cat-1',
      sku: 'NEW-1',
      name: 'New',
      price: '5.00',
    });
    await list.execute({ tenantId: 'tenant-2', page: 1 });

    // tenant-2's cache is untouched by a tenant-1 mutation → served from cache.
    expect(products.findMany).toHaveBeenCalledOnce();
  });

  it('the query fingerprint verifies params still reach the repository', async () => {
    const list = new ListProductsUseCase(products, cache);
    await list.execute({ tenantId: TENANT, page: 1, isActive: false, sortBy: 'price' });
    const query = vi.mocked(products.findMany).mock.calls[0]![1] as ProductQuery;
    expect(query.filters).toEqual({ isActive: false });
    expect(query.sort).toEqual({ field: 'price', direction: 'asc' });
  });
});
