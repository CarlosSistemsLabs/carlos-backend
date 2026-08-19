import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { queryFingerprint, VersionedListCache } from '@application/cache/query-cache.js';
import {
  PRODUCT_LIST_CACHE_NAMESPACE,
  PRODUCT_LIST_CACHE_TTL_SECONDS,
} from '@application/cache/cache-ttls.js';
import type {
  IProductRepository,
  ProductFilters,
  ProductQuery,
  ProductSort,
} from '../../domain/repositories/product-repository.js';
import {
  normalizePagination,
  toPagedProductOutput,
  type ListProductsInputDto,
  type PagedResult,
  type ProductOutput,
} from '../dto/product-dtos.js';

/**
 * Lists products for a tenant with pagination, filtering and sorting
 * (Requirements 9.1, 26.1, 26.5).
 *
 * Pagination is clamped to the platform bounds (default page size 20, max 100)
 * via {@link normalizePagination} before reaching the repository, so a hostile
 * or buggy client can never request an unbounded page. Supported filters are
 * `categoryId` and `isActive`.
 *
 * **Query-result caching (task 39.4, Requirement 26.1).** Product lists are
 * read on nearly every catalogue screen, so results are cached cache-aside via
 * a {@link VersionedListCache}: the cache key embeds the tenant, a per-tenant
 * version and a {@link queryFingerprint} of the effective query (page, page
 * size, filters, sort — plus an `op` discriminator so a list and a search that
 * happen to normalise to the same params never collide). On a hit the cached
 * page is returned without touching the repository; on a miss the repository is
 * queried and the page cached with {@link PRODUCT_LIST_CACHE_TTL_SECONDS}.
 * Product mutations (create/update/delete) bump the tenant's version to
 * invalidate every cached permutation at once. Caching is best-effort: a cache
 * fault degrades to a direct repository query.
 *
 * **Low-stock filtering** is intentionally NOT handled here: deciding whether a
 * product is low on stock requires its current on-hand quantity, which lives in
 * the Stock module, not the product catalogue. That filter belongs to a
 * stock-aware listing and is deferred to the Stock module.
 */
export class ListProductsUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly products: IProductRepository,
    cache: ICache = new NoOpCache(),
    ttlSeconds: number = PRODUCT_LIST_CACHE_TTL_SECONDS,
  ) {
    this.listCache = new VersionedListCache(cache, PRODUCT_LIST_CACHE_NAMESPACE, ttlSeconds);
  }

  async execute(input: ListProductsInputDto): Promise<PagedResult<ProductOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: ProductFilters = {};
    if (input.categoryId !== undefined) {
      filters.categoryId = input.categoryId;
    }
    if (input.isActive !== undefined) {
      filters.isActive = input.isActive;
    }

    const query: ProductQuery = { page, pageSize, filters };
    if (input.sortBy !== undefined) {
      const sort: ProductSort = {
        field: input.sortBy,
        direction: input.sortDirection ?? 'asc',
      };
      query.sort = sort;
    }

    const fingerprint = queryFingerprint({
      op: 'list',
      page,
      pageSize,
      categoryId: input.categoryId,
      isActive: input.isActive,
      sortBy: input.sortBy,
      sortDirection: input.sortBy === undefined ? undefined : (input.sortDirection ?? 'asc'),
      currency: input.currency,
    });

    return this.listCache.read(input.tenantId, fingerprint, async () => {
      const result = await this.products.findMany(input.tenantId, query);
      return toPagedProductOutput(result);
    });
  }
}
