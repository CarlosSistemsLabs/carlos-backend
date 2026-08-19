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
} from '../../domain/repositories/product-repository.js';
import {
  normalizePagination,
  toPagedProductOutput,
  type PagedResult,
  type ProductOutput,
  type SearchProductsInputDto,
} from '../dto/product-dtos.js';

/**
 * Searches a tenant's catalogue by a free-text term (Requirements 9.1, 26.1,
 * 26.5).
 *
 * The term is matched, case-insensitively, against product name and SKU. An
 * empty/whitespace term degrades to an unfiltered (but still paginated) listing
 * rather than erroring. Optional `categoryId`/`isActive` filters narrow the
 * result set. Pagination is clamped to the platform bounds (max page size 100).
 *
 * **Query-result caching (task 39.4, Requirement 26.1).** Search results are
 * cached cache-aside via a {@link VersionedListCache} that SHARES the product
 * list namespace/version with {@link ListProductsUseCase}, so a single product
 * mutation invalidates both cached lists and cached searches for the tenant.
 * The cache key embeds the tenant, the shared version and a
 * {@link queryFingerprint} of the query (trimmed term, page, page size,
 * filters) tagged with `op=search` so a search can never collide with a plain
 * list. Caching is best-effort and degrades to a direct repository query on a
 * cache fault.
 *
 * **Full-text-search preparation:** this use case depends only on the
 * {@link IProductRepository.findMany} port and expresses its intent through the
 * declarative {@link ProductFilters.search} option — it does NOT encode how the
 * match is performed. Today the Prisma repository implements `search` with a
 * case-insensitive `contains` (substring) query; swapping in PostgreSQL
 * full-text search (a `tsvector` column queried with `@@`/`websearch_to_tsquery`)
 * is a repository-only change behind the same port, requiring no edits to this
 * use case or its callers. Should ranking/highlighting be needed later, a
 * dedicated `IProductSearchService` port can be introduced and injected here in
 * place of the repository without touching the presentation layer.
 */
export class SearchProductsUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly products: IProductRepository,
    cache: ICache = new NoOpCache(),
    ttlSeconds: number = PRODUCT_LIST_CACHE_TTL_SECONDS,
  ) {
    this.listCache = new VersionedListCache(cache, PRODUCT_LIST_CACHE_NAMESPACE, ttlSeconds);
  }

  async execute(input: SearchProductsInputDto): Promise<PagedResult<ProductOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: ProductFilters = {};
    const term = input.term.trim();
    if (term.length > 0) {
      filters.search = term;
    }
    if (input.categoryId !== undefined) {
      filters.categoryId = input.categoryId;
    }
    if (input.isActive !== undefined) {
      filters.isActive = input.isActive;
    }

    const query: ProductQuery = {
      page,
      pageSize,
      filters,
      sort: { field: 'name', direction: 'asc' },
    };

    const fingerprint = queryFingerprint({
      op: 'search',
      term: term.length > 0 ? term : undefined,
      page,
      pageSize,
      categoryId: input.categoryId,
      isActive: input.isActive,
      currency: input.currency,
    });

    return this.listCache.read(input.tenantId, fingerprint, async () => {
      const result = await this.products.findMany(input.tenantId, query);
      return toPagedProductOutput(result);
    });
  }
}
