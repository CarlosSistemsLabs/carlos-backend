import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateProductUseCase } from './update-product.use-case.js';
import { Category } from '../../domain/entities/category.js';
import { Product } from '../../domain/entities/product.js';
import { Money } from '../../domain/value-objects/money.js';
import { Sku } from '../../domain/value-objects/sku.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import { ConflictError, NotFoundError } from '@domain/errors/index.js';

function existingProduct(): Product {
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

function makeProducts(): IProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(existingProduct()),
    findBySku: vi.fn().mockResolvedValue(null),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(async (product: Product) => product),
    softDelete: vi.fn(),
    existsBySku: vi.fn().mockResolvedValue(false),
  };
}

function makeCategories(): ICategoryRepository {
  return {
    findById: vi.fn().mockResolvedValue(
      Category.reconstitute('cat-2', {
        tenantId: 'tenant-1',
        name: 'Snacks',
        description: null,
        parentId: null,
      }),
    ),
    findByTenant: vi.fn(),
    findChildren: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
}

describe('UpdateProductUseCase', () => {
  let products: IProductRepository;
  let categories: ICategoryRepository;
  let useCase: UpdateProductUseCase;

  beforeEach(() => {
    products = makeProducts();
    categories = makeCategories();
    useCase = new UpdateProductUseCase(products, categories);
  });

  it('throws NotFoundError when the product is missing', async () => {
    vi.mocked(products.findById).mockResolvedValue(null);
    await expect(
      useCase.execute({ id: 'prod-1', tenantId: 'tenant-1', name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(products.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the product belongs to another tenant', async () => {
    await expect(
      useCase.execute({ id: 'prod-1', tenantId: 'other-tenant', name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(products.update).not.toHaveBeenCalled();
  });

  it('applies partial changes and re-validates invariants, keeping untouched fields', async () => {
    const result = await useCase.execute({
      id: 'prod-1',
      tenantId: 'tenant-1',
      name: 'Cola 1.5L',
      price: '24.50',
    });

    expect(products.update).toHaveBeenCalledOnce();
    expect(result.name).toBe('Cola 1.5L');
    expect(result.price).toBe('24.50');
    // Unchanged fields preserved.
    expect(result.sku).toBe('ABC-1');
    expect(result.cost).toBe('10.00');
    expect(result.minStock).toBe(5);
  });

  it('re-checks SKU uniqueness (excluding self) only when the SKU changes', async () => {
    await useCase.execute({ id: 'prod-1', tenantId: 'tenant-1', sku: 'xyz-9' });
    expect(products.existsBySku).toHaveBeenCalledWith('tenant-1', 'XYZ-9', 'prod-1');
  });

  it('does not re-check SKU uniqueness when the SKU is unchanged', async () => {
    await useCase.execute({ id: 'prod-1', tenantId: 'tenant-1', sku: 'abc-1' });
    expect(products.existsBySku).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the new SKU is already taken', async () => {
    vi.mocked(products.existsBySku).mockResolvedValue(true);
    await expect(
      useCase.execute({ id: 'prod-1', tenantId: 'tenant-1', sku: 'xyz-9' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(products.update).not.toHaveBeenCalled();
  });

  it('verifies the target category exists when the category changes', async () => {
    await useCase.execute({ id: 'prod-1', tenantId: 'tenant-1', categoryId: 'cat-2' });
    expect(categories.findById).toHaveBeenCalledWith('cat-2');
  });

  it('throws NotFoundError when the new category is missing', async () => {
    vi.mocked(categories.findById).mockResolvedValue(null);
    await expect(
      useCase.execute({ id: 'prod-1', tenantId: 'tenant-1', categoryId: 'cat-2' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(products.update).not.toHaveBeenCalled();
  });

  it('clears a nullable field when null is supplied', async () => {
    const result = await useCase.execute({ id: 'prod-1', tenantId: 'tenant-1', cost: null });
    expect(result.cost).toBeNull();
  });
});
