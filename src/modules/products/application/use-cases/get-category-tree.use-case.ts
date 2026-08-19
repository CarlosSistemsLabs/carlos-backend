import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import {
  buildCategoryTree,
  type CategoryTreeNode,
  type GetCategoryTreeInputDto,
} from '../dto/category-dtos.js';

/**
 * Builds the hierarchical category tree for a tenant (Requirement 9.1).
 *
 * Performs a SINGLE {@link ICategoryRepository.findByTenant} fetch and assembles
 * the roots → nested children structure in memory via {@link buildCategoryTree}
 * (O(n)), deliberately avoiding the N+1 queries a recursive `findChildren`
 * traversal would incur.
 */
export class GetCategoryTreeUseCase {
  constructor(private readonly categories: ICategoryRepository) {}

  async execute(input: GetCategoryTreeInputDto): Promise<CategoryTreeNode[]> {
    const categories = await this.categories.findByTenant(input.tenantId);
    return buildCategoryTree(categories);
  }
}
