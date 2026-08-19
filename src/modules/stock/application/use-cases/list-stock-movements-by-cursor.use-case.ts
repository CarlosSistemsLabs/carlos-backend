import { normalizeCursorLimit } from '@shared/pagination/cursor.js';
import { assertStockMovementType } from '../../domain/value-objects/stock-movement-type.js';
import type {
  IStockMovementCursorReader,
  StockMovementCursorQuery,
} from '../../domain/repositories/stock-movement-cursor-reader.js';
import type { StockMovementFilters } from '../../domain/repositories/stock-movement-repository.js';
import {
  toCursorPagedStockMovementOutput,
  type CursorPagedResult,
  type ListStockMovementsByCursorInputDto,
  type StockMovementOutput,
} from '../dto/stock-dtos.js';

/**
 * Lists the stock-movement audit history using cursor (keyset) pagination for
 * large datasets (Requirement 26.6, task 39.3).
 *
 * This is the scalable companion to {@link import('./get-stock-movement-history.use-case.js').GetStockMovementHistoryUseCase}:
 * both expose the same filters (product, branch, type, `createdAt` range) and
 * newest-first ordering, but this variant pages by an opaque cursor instead of
 * an offset, so deep pages cost the same as the first one on the unbounded,
 * append-only movement table. The page size is clamped to the platform bounds
 * (default 20, max 100) via {@link normalizeCursorLimit}, and an unknown
 * movement type fails fast before the query runs rather than silently matching
 * nothing.
 */
export class ListStockMovementsByCursorUseCase {
  constructor(private readonly movements: IStockMovementCursorReader) {}

  async execute(
    input: ListStockMovementsByCursorInputDto,
  ): Promise<CursorPagedResult<StockMovementOutput>> {
    const limit = normalizeCursorLimit(input.limit);

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

    const query: StockMovementCursorQuery = { limit, filters };
    if (input.cursor !== undefined) {
      query.cursor = input.cursor;
    }

    const page = await this.movements.findManyByCursor(input.tenantId, query);
    return toCursorPagedStockMovementOutput(page);
  }
}
