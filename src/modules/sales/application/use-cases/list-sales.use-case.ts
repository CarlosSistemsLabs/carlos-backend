import type {
  ISaleRepository,
  SaleFilters,
  SaleQuery,
  SaleSort,
} from '../../domain/repositories/sale-repository.js';
import {
  normalizePagination,
  toPagedSaleOutput,
  type ListSalesInputDto,
  type PagedResult,
  type SaleOutput,
} from '../dto/sale-dtos.js';

/**
 * Lists sales for a tenant with pagination, filtering and sorting
 * (Requirements 9.1, 26.5).
 *
 * Pagination is clamped to the platform bounds (default page size 20, max 100)
 * via {@link normalizePagination} before reaching the repository, so a hostile
 * or buggy client can never request an unbounded page. Supported filters are
 * `customerId`, `branchId`, `status` and an inclusive `from`/`to` `saleDate`
 * range; the repository applies a stable default ordering when no `sort` is
 * supplied.
 */
export class ListSalesUseCase {
  constructor(private readonly sales: ISaleRepository) {}

  async execute(input: ListSalesInputDto): Promise<PagedResult<SaleOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: SaleFilters = {};
    if (input.customerId !== undefined) {
      filters.customerId = input.customerId;
    }
    if (input.branchId !== undefined) {
      filters.branchId = input.branchId;
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

    const query: SaleQuery = { page, pageSize, filters };
    if (input.sortBy !== undefined) {
      const sort: SaleSort = {
        field: input.sortBy,
        direction: input.sortDirection ?? 'desc',
      };
      query.sort = sort;
    }

    const result = await this.sales.findMany(input.tenantId, query);
    return toPagedSaleOutput(result);
  }
}
