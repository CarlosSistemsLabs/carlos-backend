import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import type { DeleteCategoryInputDto } from '../dto/category-dtos.js';

/**
 * Soft-deletes a category (Requirement 9.4).
 *
 * **Delete policy (safe / non-cascading):** the category is removed only when
 * it is empty. Deletion is REJECTED with a {@link ConflictError} (HTTP 409)
 * when the category still has:
 * - child categories — deleting it would orphan an entire subtree; or
 * - products assigned to it — `Product.categoryId` is NOT NULL, so orphaned
 *   products would violate referential integrity.
 *
 * This is preferred over a cascading delete, which could silently destroy large
 * amounts of catalogue/inventory data. Callers must first move or remove the
 * children/products, then delete the (now empty) category. The product check is
 * tenant-scoped via the repository's paginated query (only the total count is
 * needed, so a single 1-item page is fetched).
 */
export class DeleteCategoryUseCase {
  constructor(
    private readonly categories: ICategoryRepository,
    private readonly products: IProductRepository,
  ) {}

  async execute(input: DeleteCategoryInputDto): Promise<void> {
    const category = await this.categories.findById(input.id);
    if (category === null || category.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Category', input.id);
    }

    const children = await this.categories.findChildren(input.tenantId, input.id);
    if (children.length > 0) {
      throw new ConflictError('Cannot delete a category that has child categories', {
        categoryId: input.id,
        childCount: children.length,
      });
    }

    const assigned = await this.products.findMany(input.tenantId, {
      page: 1,
      pageSize: 1,
      filters: { categoryId: input.id },
    });
    if (assigned.total > 0) {
      throw new ConflictError('Cannot delete a category that has assigned products', {
        categoryId: input.id,
        productCount: assigned.total,
      });
    }

    await this.categories.softDelete(category.id);
  }
}
