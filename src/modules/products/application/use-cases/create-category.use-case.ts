import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import { Category } from '../../domain/entities/category.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import {
  toCategoryOutput,
  type CategoryOutput,
  type CreateCategoryInputDto,
} from '../dto/category-dtos.js';

/**
 * Creates a new category within a tenant (Requirement 9.1).
 *
 * Enforces the cross-aggregate invariants the {@link Category} entity cannot
 * see on its own:
 * - when a `parentId` is supplied, the parent category must exist and belong to
 *   the same tenant (else 404), preventing dangling/cross-tenant references;
 * - the name must be unique among the siblings sharing the same parent scope
 *   (case-insensitive), so a tenant cannot create two "Drinks" under the same
 *   parent. Uniqueness is scoped to the parent rather than the whole tenant so
 *   the same name may legitimately appear in different branches of the tree.
 */
export class CreateCategoryUseCase {
  constructor(private readonly categories: ICategoryRepository) {}

  async execute(input: CreateCategoryInputDto): Promise<CategoryOutput> {
    const parentId = input.parentId ?? null;

    // The parent (when supplied) must exist and belong to the same tenant.
    if (parentId !== null) {
      const parent = await this.categories.findById(parentId);
      if (parent === null || parent.tenantId !== input.tenantId) {
        throw NotFoundError.forEntity('Category', parentId);
      }
    }

    // Name must be unique within the parent scope (case-insensitive).
    await this.assertNameAvailable(input.tenantId, parentId, input.name);

    const category = Category.create({
      tenantId: input.tenantId,
      name: input.name,
      description: input.description ?? null,
      parentId,
    });

    const saved = await this.categories.create(category);
    return toCategoryOutput(saved);
  }

  private async assertNameAvailable(
    tenantId: string,
    parentId: string | null,
    name: string,
  ): Promise<void> {
    const normalized = name.trim().toLowerCase();
    const siblings = await this.categories.findChildren(tenantId, parentId);
    const clash = siblings.some((sibling) => sibling.name.trim().toLowerCase() === normalized);
    if (clash) {
      throw new ConflictError('A category with this name already exists in this scope', {
        field: 'name',
        name: name.trim(),
        parentId,
      });
    }
  }
}
