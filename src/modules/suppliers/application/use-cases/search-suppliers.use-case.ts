import type {
  ISupplierRepository,
  SupplierFilters,
  SupplierQuery,
} from '../../domain/repositories/supplier-repository.js';
import {
  normalizePagination,
  toPagedSupplierOutput,
  type PagedResult,
  type SearchSuppliersInputDto,
  type SupplierOutput,
} from '../dto/supplier-dtos.js';

/**
 * Searches a tenant's suppliers by a free-text term (Requirements 9.1, 26.5).
 *
 * The term is matched, case-insensitively, across the supplier's name, email,
 * phone and tax id. An empty/whitespace term degrades to an unfiltered (but
 * still paginated) listing rather than erroring. An optional `isActive` filter
 * narrows the result set. Pagination is clamped to the platform bounds (max page
 * size 100).
 *
 * **Full-text-search preparation:** this use case depends only on the
 * {@link ISupplierRepository.findMany} port and expresses its intent through the
 * declarative {@link SupplierFilters.search} option — it does NOT encode how the
 * match is performed. Today the Prisma repository implements `search` with a
 * case-insensitive `contains` (substring) query; swapping in PostgreSQL
 * full-text search is a repository-only change behind the same port.
 */
export class SearchSuppliersUseCase {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(input: SearchSuppliersInputDto): Promise<PagedResult<SupplierOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: SupplierFilters = {};
    const term = input.term.trim();
    if (term.length > 0) {
      filters.search = term;
    }
    if (input.isActive !== undefined) {
      filters.isActive = input.isActive;
    }

    const query: SupplierQuery = {
      page,
      pageSize,
      filters,
      sort: { field: 'name', direction: 'asc' },
    };

    const result = await this.suppliers.findMany(input.tenantId, query);
    return toPagedSupplierOutput(result);
  }
}
