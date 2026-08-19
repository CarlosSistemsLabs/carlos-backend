import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateCategoryUseCase } from './create-category.use-case.js';
import { Category } from '../../domain/entities/category.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import type { CreateCategoryInputDto } from '../dto/category-dtos.js';

const TENANT = 'tenant-1';
const PARENT_ID = 'parent-1';

function makeCategories(): ICategoryRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByTenant: vi.fn().mockResolvedValue([]),
    findChildren: vi.fn().mockResolvedValue([]),
    create: vi.fn(async (c: Category) => c),
    update: vi.fn(async (c: Category) => c),
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
}

const input: CreateCategoryInputDto = {
  tenantId: TENANT,
  name: 'Drinks',
};

describe('CreateCategoryUseCase', () => {
  let categories: ICategoryRepository;
  let useCase: CreateCategoryUseCase;

  beforeEach(() => {
    categories = makeCategories();
    useCase = new CreateCategoryUseCase(categories);
  });

  it('creates a root category', async () => {
    const result = await useCase.execute(input);
    expect(categories.create).toHaveBeenCalledOnce();
    expect(result.name).toBe('Drinks');
    expect(result.parentId).toBeNull();
    expect(result.tenantId).toBe(TENANT);
  });

  it('creates a child category when the parent exists for the tenant', async () => {
    vi.mocked(categories.findById).mockResolvedValue(
      Category.reconstitute(PARENT_ID, {
        tenantId: TENANT,
        name: 'Beverages',
        description: null,
        parentId: null,
      }),
    );
    const result = await useCase.execute({ ...input, parentId: PARENT_ID });
    expect(categories.findById).toHaveBeenCalledWith(PARENT_ID);
    expect(result.parentId).toBe(PARENT_ID);
  });

  it('throws NotFoundError when the parent does not exist', async () => {
    vi.mocked(categories.findById).mockResolvedValue(null);
    await expect(useCase.execute({ ...input, parentId: PARENT_ID })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(categories.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the parent belongs to another tenant', async () => {
    vi.mocked(categories.findById).mockResolvedValue(
      Category.reconstitute(PARENT_ID, {
        tenantId: 'other-tenant',
        name: 'Beverages',
        description: null,
        parentId: null,
      }),
    );
    await expect(useCase.execute({ ...input, parentId: PARENT_ID })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(categories.create).not.toHaveBeenCalled();
  });

  it('throws ConflictError when a sibling with the same name exists (case-insensitive)', async () => {
    vi.mocked(categories.findChildren).mockResolvedValue([
      Category.reconstitute('sibling-1', {
        tenantId: TENANT,
        name: 'drinks',
        description: null,
        parentId: null,
      }),
    ]);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(categories.create).not.toHaveBeenCalled();
  });
});
