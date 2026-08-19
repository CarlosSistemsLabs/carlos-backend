import { NotFoundError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { VersionedListCache } from '@application/cache/query-cache.js';
import { PRODUCT_LIST_CACHE_NAMESPACE } from '@application/cache/cache-ttls.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import type { DeleteProductInputDto } from '../dto/product-dtos.js';

/**
 * Soft-deletes a product (Requirements 9.4, 26.1).
 *
 * The product is loaded first so a missing (or cross-tenant) id yields a 404
 * rather than silently succeeding. Deletion stamps `deletedAt` via the
 * repository; the row is retained for audit/restore and excluded from
 * subsequent reads.
 *
 * **Cache invalidation (task 39.4, Requirement 26.1).** A soft-delete removes
 * the product from every subsequent list/search, so after the delete the
 * tenant's product-list cache version is bumped to invalidate all cached
 * permutations at once (see {@link VersionedListCache}).
 */
export class DeleteProductUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly products: IProductRepository,
    cache: ICache = new NoOpCache(),
  ) {
    this.listCache = new VersionedListCache(cache, PRODUCT_LIST_CACHE_NAMESPACE, 0);
  }

  async execute(input: DeleteProductInputDto): Promise<void> {
    const existing = await this.products.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Product', input.id);
    }

    await this.products.softDelete(existing.id);
    await this.listCache.invalidate(input.tenantId);
  }
}
