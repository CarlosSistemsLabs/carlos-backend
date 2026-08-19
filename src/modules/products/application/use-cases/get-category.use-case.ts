import { NotFoundError } from '@domain/errors/index.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import {
  toCategoryOutput,
  type CategoryOutput,
  type GetCategoryInputDto,
} from '../dto/category-dtos.js';

/**
 * Reads a single category by id (Requirement 9.1).
 *
 * The category is loaded by id and its tenant ownership is verified: a missing
 * (soft-deleted) category or one owned by another tenant yields a 404 rather
 * than leaking cross-tenant existence (Requirement 1.5).
 */
export class GetCategoryUseCase {
  constructor(private readonly categories: ICategoryRepository) {}

  async execute(input: GetCategoryInputDto): Promise<CategoryOutput> {
    const category = await this.categories.findById(input.id);
    if (category === null || category.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Category', input.id);
    }
    return toCategoryOutput(category);
  }
}
