import { NotFoundError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { VersionedListCache } from '@application/cache/query-cache.js';
import { CUSTOMER_LIST_CACHE_NAMESPACE } from '@application/cache/cache-ttls.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import type { DeleteCustomerInputDto } from '../dto/customer-dtos.js';

/**
 * Soft-deletes a customer (Requirements 9.4, 26.1).
 *
 * The customer is loaded first so a missing (or cross-tenant) id yields a 404
 * rather than silently succeeding. Deletion stamps `deletedAt` via the
 * repository; the row is retained for audit/restore and excluded from
 * subsequent reads.
 *
 * **Cache invalidation (task 39.4, Requirement 26.1).** A soft-delete removes
 * the customer from every subsequent list/search, so after the delete the
 * tenant's customer-list cache version is bumped to invalidate all cached
 * permutations at once (see {@link VersionedListCache}).
 */
export class DeleteCustomerUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly customers: ICustomerRepository,
    cache: ICache = new NoOpCache(),
  ) {
    this.listCache = new VersionedListCache(cache, CUSTOMER_LIST_CACHE_NAMESPACE, 0);
  }

  async execute(input: DeleteCustomerInputDto): Promise<void> {
    const existing = await this.customers.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Customer', input.id);
    }

    await this.customers.softDelete(existing.id);
    await this.listCache.invalidate(input.tenantId);
  }
}
