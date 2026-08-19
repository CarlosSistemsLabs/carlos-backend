import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import {
  toCategoryOutput,
  type CategoryOutput,
  type ListCategoriesInputDto,
} from '../dto/category-dtos.js';

/**
 * Lists all categories for a tenant as a flat collection (Requirement 9.1).
 *
 * Returns every (non-deleted) category sorted by the repository (by name). For
 * the hierarchical view, use {@link GetCategoryTreeUseCase} instead.
 */
export class ListCategoriesUseCase {
  constructor(private readonly categories: ICategoryRepository) {}

  async execute(input: ListCategoriesInputDto): Promise<CategoryOutput[]> {
    const categories = await this.categories.findByTenant(input.tenantId);
    return categories.map(toCategoryOutput);
  }
}
