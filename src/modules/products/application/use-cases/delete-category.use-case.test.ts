import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteCategoryUseCase } from './delete-category.use-case.js';
import { Category } from '../../domain/entities/category.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import type { PaginatedResult } from '@shared/types/index.js';
import type { Product } from '../../domain/entities/product.js';

const TENANT = 'tenant-1';
const CATEGORY_ID = 'cat-1';

function emptyPage(): PaginatedResult<Product> {
  return { items: [], total: 0, page: 1, pageSize: 1, totalPages: 0 };
}

function makeCategories(): ICategoryRepository {
  return {
    findById: vi.fn().mockResolvedValue(
      Category.reconstitute(CATEGORY_ID, {
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
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeProducts(): IProductRepository {
  return {
    findById: vi.fn(),
    findBySku: vi.fn(),
    findMany: vi.fn().mockResolvedValue(emptyPage()),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsBySku: vi.fn(),
  };
}

describe('DeleteCategoryUseCase', () => {
  let categories: ICategoryRepository;
  let products: IProductRepository;
  let useCase: DeleteCategoryUseCase;

  beforeEach(() => {
    categories = makeCategories();
    products = makeProducts();
    useCase = new DeleteCategoryUseCase(categories, products);
  });

  it('soft-deletes an empty category', async () => {
    await useCase.execute({ id: CATEGORY_ID, tenantId: TENANT });
    expect(categories.softDelete).toHaveBeenCalledWith(CATEGORY_ID);
  });

  it('throws NotFoundError when the category is missing', async () => {
    vi.mocked(categories.findById).mockResolvedValue(null);
    await expect(useCase.execute({ id: CATEGORY_ID, tenantId: TENANT })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(categories.softDelete).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the category belongs to another tenant', async () => {
    vi.mocked(categories.findById).mockResolvedValue(
      Category.reconstitute(CATEGORY_ID, {
        tenantId: 'other',
        name: 'Drinks',
        description: null,
        parentId: null,
      }),
    );
    await expect(useCase.execute({ id: CATEGORY_ID, tenantId: TENANT })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects deletion when the category has children', async () => {
    vi.mocked(categories.findChildren).mockResolvedValue([
      Category.reconstitute('child-1', {
        tenantId: TENANT,
        name: 'Soft Drinks',
        description: null,
        parentId: CATEGORY_ID,
      }),
    ]);
    await expect(useCase.execute({ id: CATEGORY_ID, tenantId: TENANT })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(categories.softDelete).not.toHaveBeenCalled();
  });

  it('rejects deletion when the category has assigned products', async () => {
    vi.mocked(products.findMany).mockResolvedValue({ ...emptyPage(), total: 3 });
    await expect(useCase.execute({ id: CATEGORY_ID, tenantId: TENANT })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(categories.softDelete).not.toHaveBeenCalled();
  });
});
