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
} from '../../domain/repositories/customer-repository.js';
import {
  normalizePagination,
  toPagedCustomerOutput,
  type CustomerOutput,
  type PagedResult,
  type SearchCustomersInputDto,
} from '../dto/customer-dtos.js';

/**
 * Searches a tenant's customers by a free-text term (Requirements 9.1, 26.1,
 * 26.5).
 *
 * The term is matched, case-insensitively, across the customer's name, email,
 * phone and tax id. An empty/whitespace term degrades to an unfiltered (but
 * still paginated) listing rather than erroring. An optional `isActive` filter
 * narrows the result set. Pagination is clamped to the platform bounds (max page
 * size 100).
 *
 * **Query-result caching (task 39.4, Requirement 26.1).** Search results are
 * cached cache-aside via a {@link VersionedListCache} that SHARES the customer
 * list namespace/version with {@link ListCustomersUseCase}, so a single customer
 * mutation invalidates both cached lists and cached searches. The key embeds the
 * tenant, the shared version and a {@link queryFingerprint} of the query tagged
 * `op=search` so a search never collides with a plain list. Caching is
 * best-effort and degrades to a direct repository query on a cache fault.
 *
 * **Full-text-search preparation:** this use case depends only on the
 * {@link ICustomerRepository.findMany} port and expresses its intent through the
 * declarative {@link CustomerFilters.search} option — it does NOT encode how the
 * match is performed. Today the Prisma repository implements `search` with a
 * case-insensitive `contains` (substring) query; swapping in PostgreSQL
 * full-text search is a repository-only change behind the same port.
 */
export class SearchCustomersUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly customers: ICustomerRepository,
    cache: ICache = new NoOpCache(),
    ttlSeconds: number = CUSTOMER_LIST_CACHE_TTL_SECONDS,
  ) {
    this.listCache = new VersionedListCache(cache, CUSTOMER_LIST_CACHE_NAMESPACE, ttlSeconds);
  }

  async execute(input: SearchCustomersInputDto): Promise<PagedResult<CustomerOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: CustomerFilters = {};
    const term = input.term.trim();
    if (term.length > 0) {
      filters.search = term;
    }
    if (input.isActive !== undefined) {
      filters.isActive = input.isActive;
    }

    const query: CustomerQuery = {
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
      isActive: input.isActive,
    });

    return this.listCache.read(input.tenantId, fingerprint, async () => {
      const result = await this.customers.findMany(input.tenantId, query);
      return toPagedCustomerOutput(result);
    });
  }
}
