import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateProductUseCase } from './create-product.use-case.js';
import { Category } from '../../domain/entities/category.js';
import type { Product } from '../../domain/entities/product.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import { InvalidPriceError } from '../../domain/errors/product-errors.js';
import type { CreateProductInputDto } from '../dto/product-dtos.js';

function makeProducts(): IProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findBySku: vi.fn().mockResolvedValue(null),
    findMany: vi.fn(),
    create: vi.fn(async (product: Product) => product),
    update: vi.fn(async (product: Product) => product),
    softDelete: vi.fn().mockResolvedValue(undefined),
    existsBySku: vi.fn().mockResolvedValue(false),
  };
}

function makeCategories(): ICategoryRepository {
  return {
    findById: vi.fn().mockResolvedValue(
      Category.reconstitute('cat-1', {
        tenantId: 'tenant-1',
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

const input: CreateProductInputDto = {
  tenantId: 'tenant-1',
  categoryId: 'cat-1',
  sku: 'abc-1',
  name: 'Cola 1L',
  price: '19.90',
  cost: '10.00',
  taxRate: 21,
};

describe('CreateProductUseCase', () => {
  let products: IProductRepository;
  let categories: ICategoryRepository;
  let useCase: CreateProductUseCase;

  beforeEach(() => {
    products = makeProducts();
    categories = makeCategories();
    useCase = new CreateProductUseCase(products, categories);
  });

  it('creates a product, normalising the SKU and exposing money as decimal strings', async () => {
    const result = await useCase.execute(input);

    expect(categories.findById).toHaveBeenCalledWith('cat-1');
    expect(products.existsBySku).toHaveBeenCalledWith('tenant-1', 'ABC-1');
    expect(products.create).toHaveBeenCalledOnce();
    expect(result.sku).toBe('ABC-1');
    expect(result.price).toBe('19.90');
    expect(result.cost).toBe('10.00');
    expect(result.currency).toBe('ARS');
    // 19.90 * 1.21 = 24.079 -> rounded half-up to 24.08
    expect(result.priceWithTax).toBe('24.08');
    expect(result.isActive).toBe(true);
  });

  it('throws ConflictError when the SKU already exists for the tenant', async () => {
    vi.mocked(products.existsBySku).mockResolvedValue(true);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(products.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the category does not exist', async () => {
    vi.mocked(categories.findById).mockResolvedValue(null);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(NotFoundError);
    expect(products.existsBySku).not.toHaveBeenCalled();
    expect(products.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the category belongs to another tenant', async () => {
    vi.mocked(categories.findById).mockResolvedValue(
      Category.reconstitute('cat-1', {
        tenantId: 'other-tenant',
        name: 'Drinks',
        description: null,
        parentId: null,
      }),
    );
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(NotFoundError);
    expect(products.create).not.toHaveBeenCalled();
  });

  it('rejects a non-positive price via the domain invariant', async () => {
    await expect(useCase.execute({ ...input, price: '0.00' })).rejects.toBeInstanceOf(
      InvalidPriceError,
    );
    expect(products.create).not.toHaveBeenCalled();
  });
});
