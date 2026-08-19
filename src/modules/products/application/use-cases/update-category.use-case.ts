import { BusinessRuleError, NotFoundError } from '@domain/errors/index.js';
import type { UUID } from '@shared/types/index.js';
import type { Category } from '../../domain/entities/category.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import {
  toCategoryOutput,
  type CategoryOutput,
  type UpdateCategoryInputDto,
} from '../dto/category-dtos.js';

/**
 * Updates an existing category — rename and/or reparent (Requirement 9.1).
 *
 * Loads the category (404 when missing or owned by another tenant). When the
 * parent changes, this use case performs the **multi-level cycle detection**
 * the {@link Category} entity intentionally deferred: it walks the new parent's
 * ancestor chain (via the repository) and rejects the move with a
 * {@link BusinessRuleError} (HTTP 422) if the category being moved appears
 * anywhere in that chain — i.e. the new parent is the category itself or one of
 * its descendants, which would create a cycle (A → B → A).
 *
 * Passing `parentId: null` detaches the category (makes it a root) and can
 * never create a cycle, so it skips the walk.
 */
export class UpdateCategoryUseCase {
  constructor(private readonly categories: ICategoryRepository) {}

  async execute(input: UpdateCategoryInputDto): Promise<CategoryOutput> {
    const category = await this.categories.findById(input.id);
    if (category === null || category.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Category', input.id);
    }

    if (input.name !== undefined) {
      category.rename(input.name, input.description);
    } else if (input.description !== undefined) {
      // Update description without touching the name.
      category.rename(category.name, input.description);
    }

    if (input.parentId !== undefined) {
      await this.reparent(category, input.parentId, input.tenantId);
    }

    const saved = await this.categories.update(category);
    return toCategoryOutput(saved);
  }

  /**
   * Re-points the category at a new parent (or detaches it when `null`),
   * guarding against hierarchy cycles.
   */
  private async reparent(
    category: Category,
    newParentId: UUID | null,
    tenantId: UUID,
  ): Promise<void> {
    if (newParentId !== null) {
      const parent = await this.categories.findById(newParentId);
      if (parent === null || parent.tenantId !== tenantId) {
        throw NotFoundError.forEntity('Category', newParentId);
      }
      await this.assertNoCycle(category.id, parent, tenantId);
    }
    category.setParent(newParentId);
  }

  /**
   * Walks the ancestor chain starting at `parent`. If `categoryId` is
   * encountered, moving the category under `parent` would form a cycle.
   *
   * A `visited` guard protects against terminating on any pre-existing cycle in
   * the data, so this never loops forever even if persisted state is corrupt.
   */
  private async assertNoCycle(
    categoryId: UUID,
    parent: Category,
    tenantId: UUID,
  ): Promise<void> {
    const visited = new Set<UUID>();
    let current: Category | null = parent;
    while (current !== null) {
      if (current.id === categoryId) {
        throw new BusinessRuleError(
          'Cannot move a category under itself or one of its descendants',
          { categoryId, parentId: parent.id },
        );
      }
      if (visited.has(current.id)) {
        break;
      }
      visited.add(current.id);
      const parentId: UUID | null = current.parentId;
      current =
        parentId === null
          ? null
          : await this.categories.findById(parentId);
      if (current !== null && current.tenantId !== tenantId) {
        // Defensive: never walk into another tenant's data.
        break;
      }
    }
  }
}
