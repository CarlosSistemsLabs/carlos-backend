import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateCategoryUseCase } from './update-category.use-case.js';
import { Category } from '../../domain/entities/category.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import { BusinessRuleError, NotFoundError } from '@domain/errors/index.js';

const TENANT = 'tenant-1';

/**
 * In-memory category repository for cycle-detection tests. Cycle detection
 * walks the ancestor chain, so a real graph is more meaningful than ad-hoc
 * mocks.
 */
class FakeCategoryRepository implements ICategoryRepository {
  private readonly byId = new Map<string, Category>();

  seed(category: Category): void {
    this.byId.set(category.id, category);
  }

  async findById(id: string): Promise<Category | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTenant(tenantId: string): Promise<Category[]> {
    return [...this.byId.values()].filter((c) => c.tenantId === tenantId);
  }

  async findChildren(tenantId: string, parentId: string | null): Promise<Category[]> {
    return [...this.byId.values()].filter(
      (c) => c.tenantId === tenantId && c.parentId === parentId,
    );
  }

  async create(category: Category): Promise<Category> {
    this.seed(category);
    return category;
  }

  async update(category: Category): Promise<Category> {
    this.seed(category);
    return category;
  }

  async softDelete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}

function category(id: string, parentId: string | null): Category {
  return Category.reconstitute(id, {
    tenantId: TENANT,
    name: id,
    description: null,
    parentId,
  });
}

describe('UpdateCategoryUseCase', () => {
  let repo: FakeCategoryRepository;
  let useCase: UpdateCategoryUseCase;

  beforeEach(() => {
    repo = new FakeCategoryRepository();
    useCase = new UpdateCategoryUseCase(repo);
  });

  it('renames a category', async () => {
    repo.seed(category('a', null));
    const result = await useCase.execute({ id: 'a', tenantId: TENANT, name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('throws NotFoundError when the category is missing', async () => {
    await expect(
      useCase.execute({ id: 'missing', tenantId: TENANT, name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when reparenting to a missing parent', async () => {
    repo.seed(category('a', null));
    await expect(
      useCase.execute({ id: 'a', tenantId: TENANT, parentId: 'ghost' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reparents under a valid parent', async () => {
    repo.seed(category('a', null));
    repo.seed(category('b', null));
    const result = await useCase.execute({ id: 'a', tenantId: TENANT, parentId: 'b' });
    expect(result.parentId).toBe('b');
  });

  it('detaches a category to a root when parentId is null', async () => {
    repo.seed(category('a', null));
    repo.seed(category('b', 'a'));
    const result = await useCase.execute({ id: 'b', tenantId: TENANT, parentId: null });
    expect(result.parentId).toBeNull();
  });

  it('rejects making a category its own parent (direct cycle)', async () => {
    repo.seed(category('a', null));
    await expect(
      useCase.execute({ id: 'a', tenantId: TENANT, parentId: 'a' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('rejects moving a category under one of its descendants (deep cycle)', async () => {
    // a -> b -> c  (c is a descendant of a). Moving a under c forms a cycle.
    repo.seed(category('a', null));
    repo.seed(category('b', 'a'));
    repo.seed(category('c', 'b'));
    await expect(
      useCase.execute({ id: 'a', tenantId: TENANT, parentId: 'c' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('allows moving a category under an unrelated subtree', async () => {
    // a -> b ; x is unrelated. Moving b under x is fine.
    repo.seed(category('a', null));
    repo.seed(category('b', 'a'));
    repo.seed(category('x', null));
    const result = await useCase.execute({ id: 'b', tenantId: TENANT, parentId: 'x' });
    expect(result.parentId).toBe('x');
  });
});
