import type {
  ISupplierRepository,
  SupplierFilters,
  SupplierQuery,
  SupplierSort,
} from '../../domain/repositories/supplier-repository.js';
import {
  normalizePagination,
  toPagedSupplierOutput,
  type ListSuppliersInputDto,
  type PagedResult,
  type SupplierOutput,
} from '../dto/supplier-dtos.js';

/**
 * Lists suppliers for a tenant with pagination, filtering and sorting
 * (Requirements 9.1, 26.5).
 *
 * Pagination is clamped to the platform bounds (default page size 20, max 100)
 * via {@link normalizePagination} before reaching the repository, so a hostile
 * or buggy client can never request an unbounded page. The only supported filter
 * is `isActive`; free-text search is handled by {@link SearchSuppliersUseCase}.
 */
export class ListSuppliersUseCase {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(input: ListSuppliersInputDto): Promise<PagedResult<SupplierOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: SupplierFilters = {};
    if (input.isActive !== undefined) {
      filters.isActive = input.isActive;
    }

    const query: SupplierQuery = { page, pageSize, filters };
    if (input.sortBy !== undefined) {
      const sort: SupplierSort = {
        field: input.sortBy,
        direction: input.sortDirection ?? 'asc',
      };
      query.sort = sort;
    }

    const result = await this.suppliers.findMany(input.tenantId, query);
    return toPagedSupplierOutput(result);
  }
}
