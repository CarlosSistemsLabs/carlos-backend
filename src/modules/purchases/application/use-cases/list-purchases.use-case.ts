import type {
  IPurchaseRepository,
  PurchaseFilters,
  PurchaseQuery,
  PurchaseSort,
} from '../../domain/repositories/purchase-repository.js';
import {
  normalizePagination,
  toPagedPurchaseOutput,
  type ListPurchasesInputDto,
  type PagedResult,
  type PurchaseOutput,
} from '../dto/purchase-dtos.js';

/**
 * Lists purchases for a tenant with pagination, filtering and sorting
 * (Requirements 10.3, 26.5).
 *
 * Pagination is clamped to the platform bounds (default page size 20, max 100)
 * via {@link normalizePagination} before reaching the repository, so a hostile
 * or buggy client can never request an unbounded page. Supported filters are
 * `supplierId`, `status` and an inclusive `from`/`to` `purchaseDate` range; the
 * repository applies a stable default ordering when no `sort` is supplied.
 * Mirrors `ListSalesUseCase`.
 */
export class ListPurchasesUseCase {
  constructor(private readonly purchases: IPurchaseRepository) {}

  async execute(input: ListPurchasesInputDto): Promise<PagedResult<PurchaseOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: PurchaseFilters = {};
    if (input.supplierId !== undefined) {
      filters.supplierId = input.supplierId;
    }
    if (input.status !== undefined) {
      filters.status = input.status;
    }
    if (input.from !== undefined) {
      filters.from = input.from;
    }
    if (input.to !== undefined) {
      filters.to = input.to;
    }

    const query: PurchaseQuery = { page, pageSize, filters };
    if (input.sortBy !== undefined) {
      const sort: PurchaseSort = {
        field: input.sortBy,
        direction: input.sortDirection ?? 'desc',
      };
      query.sort = sort;
    }

    const result = await this.purchases.findMany(input.tenantId, query);
    return toPagedPurchaseOutput(result);
  }
}
