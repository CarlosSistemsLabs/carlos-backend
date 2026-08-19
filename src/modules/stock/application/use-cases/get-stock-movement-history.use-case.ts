import { assertStockMovementType } from '../../domain/value-objects/stock-movement-type.js';
import type {
  IStockMovementRepository,
  StockMovementFilters,
  StockMovementQuery,
} from '../../domain/repositories/stock-movement-repository.js';
import {
  normalizePagination,
  toPagedStockMovementOutput,
  type GetStockMovementHistoryInputDto,
  type PagedResult,
  type StockMovementOutput,
} from '../dto/stock-dtos.js';

/**
 * Retrieves the stock-movement audit history for a tenant (Requirement 9.1).
 *
 * Movements are returned newest-first and can be narrowed by product, branch,
 * movement type and an inclusive `createdAt` date range, with pagination
 * clamped to the platform bounds (default 20, max 100). It reads through the
 * append-only {@link IStockMovementRepository}; the movement type, when
 * supplied, is validated up front so an unknown value fails fast rather than
 * silently matching nothing.
 */
export class GetStockMovementHistoryUseCase {
  constructor(private readonly movements: IStockMovementRepository) {}

  async execute(
    input: GetStockMovementHistoryInputDto,
  ): Promise<PagedResult<StockMovementOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: StockMovementFilters = {};
    if (input.productId !== undefined) {
      filters.productId = input.productId;
    }
    if (input.branchId !== undefined) {
      filters.branchId = input.branchId;
    }
    if (input.type !== undefined) {
      filters.type = assertStockMovementType(input.type);
    }
    if (input.from !== undefined) {
      filters.from = input.from;
    }
    if (input.to !== undefined) {
      filters.to = input.to;
    }

    const query: StockMovementQuery = { page, pageSize, filters };
    const result = await this.movements.findMany(input.tenantId, query);
    return toPagedStockMovementOutput(result);
  }
}
