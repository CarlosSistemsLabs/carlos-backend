import type {
  IStockRepository,
  StockLevelFilters,
  StockLevelQuery,
} from '../../domain/repositories/stock-repository.js';
import {
  normalizePagination,
  toPagedStockLevelOutput,
  type GetStockLevelsInputDto,
  type PagedResult,
  type StockLevelOutput,
} from '../dto/stock-dtos.js';

/**
 * Lists stock levels for a tenant with pagination and low-stock evaluation
 * (Requirement 9.1).
 *
 * Each row carries a `lowStock` flag computed as `quantity <= product.minStock`
 * (the threshold is joined from the product catalogue by the repository). When
 * `lowStockOnly` is requested, only balances at or below their threshold are
 * returned via {@link IStockRepository.findLowStock}; otherwise the full
 * balance listing is returned. Pagination is clamped to the platform bounds
 * (default 20, max 100) before reaching the repository.
 */
export class GetStockLevelsUseCase {
  constructor(private readonly stocks: IStockRepository) {}

  async execute(input: GetStockLevelsInputDto): Promise<PagedResult<StockLevelOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: StockLevelFilters = {};
    if (input.productId !== undefined) {
      filters.productId = input.productId;
    }
    if (input.branchId !== undefined) {
      filters.branchId = input.branchId;
    }

    const query: StockLevelQuery = { page, pageSize, filters };

    const result =
      input.lowStockOnly === true
        ? await this.stocks.findLowStock(input.tenantId, query)
        : await this.stocks.findByTenant(input.tenantId, query);

    return toPagedStockLevelOutput(result);
  }
}
