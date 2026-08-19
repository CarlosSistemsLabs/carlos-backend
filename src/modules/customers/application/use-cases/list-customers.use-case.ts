import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { queryFingerprint, VersionedListCache } from '@application/cache/query-cache.js';
import {
  CUSTOMER_LIST_CACHE_NAMESPACE,
  CUSTOMER_LIST_CACHE_TTL_SECONDS,
} from '@application/cache/cache-ttls.js';
import type {
  ICustomerRepository,
  CustomerFilters,
  CustomerQuery,
  CustomerSort,
} from '../../domain/repositories/customer-repository.js';
import {
  normalizePagination,
  toPagedCustomerOutput,
  type CustomerOutput,
  type ListCustomersInputDto,
  type PagedResult,
} from '../dto/customer-dtos.js';

/**
 * Lists customers for a tenant with pagination, filtering and sorting
 * (Requirements 9.1, 26.1, 26.5).
 *
 * Pagination is clamped to the platform bounds (default page size 20, max 100)
 * via {@link normalizePagination} before reaching the repository, so a hostile
 * or buggy client can never request an unbounded page. The only supported filter
 * is `isActive`; free-text search is handled by {@link SearchCustomersUseCase}.
 *
 * **Query-result caching (task 39.4, Requirement 26.1).** Results are cached
 * cache-aside via a {@link VersionedListCache}: the key embeds the tenant, a
 * per-tenant version and a {@link queryFingerprint} of the query. On a hit the
 * cached page is returned without touching the repository; on a miss the page is
 * cached with {@link CUSTOMER_LIST_CACHE_TTL_SECONDS}. Customer mutations bump
 * the version to invalidate all cached permutations. Caching is best-effort and
 * degrades to a direct repository query on a cache fault.
 */
export class ListCustomersUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly customers: ICustomerRepository,
    cache: ICache = new NoOpCache(),
    ttlSeconds: number = CUSTOMER_LIST_CACHE_TTL_SECONDS,
  ) {
    this.listCache = new VersionedListCache(cache, CUSTOMER_LIST_CACHE_NAMESPACE, ttlSeconds);
  }

  async execute(input: ListCustomersInputDto): Promise<PagedResult<CustomerOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: CustomerFilters = {};
    if (input.isActive !== undefined) {
      filters.isActive = input.isActive;
    }

    const query: CustomerQuery = { page, pageSize, filters };
    if (input.sortBy !== undefined) {
      const sort: CustomerSort = {
        field: input.sortBy,
        direction: input.sortDirection ?? 'asc',
      };
      query.sort = sort;
    }

    const fingerprint = queryFingerprint({
      op: 'list',
      page,
      pageSize,
      isActive: input.isActive,
      sortBy: input.sortBy,
      sortDirection: input.sortBy === undefined ? undefined : (input.sortDirection ?? 'asc'),
    });

    return this.listCache.read(input.tenantId, fingerprint, async () => {
      const result = await this.customers.findMany(input.tenantId, query);
      return toPagedCustomerOutput(result);
    });
  }
}
