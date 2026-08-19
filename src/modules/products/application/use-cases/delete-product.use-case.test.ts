import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteProductUseCase } from './delete-product.use-case.js';
import { Product } from '../../domain/entities/product.js';
import { Money } from '../../domain/value-objects/money.js';
import { Sku } from '../../domain/value-objects/sku.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import { NotFoundError } from '@domain/errors/index.js';

function existingProduct(): Product {
  return Product.reconstitute('prod-1', {
    tenantId: 'tenant-1',
    categoryId: 'cat-1',
    sku: Sku.create('ABC-1'),
    name: 'Cola 1L',
    description: null,
    price: Money.fromDecimal('19.90', 'ARS'),
    cost: null,
    taxRate: 0,
    unit: 'unit',
    minStock: 0,
    isActive: true,
    imageUrl: null,
  });
}

function makeProducts(): IProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(existingProduct()),
    findBySku: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn().mockResolvedValue(undefined),
    existsBySku: vi.fn(),
  };
}

describe('DeleteProductUseCase', () => {
  let products: IProductRepository;
  let useCase: DeleteProductUseCase;

  beforeEach(() => {
    products = makeProducts();
    useCase = new DeleteProductUseCase(products);
  });

  it('soft-deletes an existing product', async () => {
    await useCase.execute({ id: 'prod-1', tenantId: 'tenant-1' });
    expect(products.softDelete).toHaveBeenCalledWith('prod-1');
  });

  it('throws NotFoundError when the product is missing', async () => {
    vi.mocked(products.findById).mockResolvedValue(null);
    await expect(useCase.execute({ id: 'prod-1', tenantId: 'tenant-1' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(products.softDelete).not.toHaveBeenCalled();
  });

  it('throws NotFoundError (and does not delete) for a cross-tenant product', async () => {
    await expect(
      useCase.execute({ id: 'prod-1', tenantId: 'other-tenant' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(products.softDelete).not.toHaveBeenCalled();
  });
});
