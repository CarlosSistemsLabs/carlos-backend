import type {
  ICashMovementRepository,
  CashMovementFilters,
  CashMovementQuery,
} from '../../domain/repositories/cash-movement-repository.js';
import {
  toPagedCashMovementOutput,
  type CashMovementOutput,
  type ListCashMovementsInputDto,
} from '../dto/cash-dtos.js';
import { normalizePagination, type PagedResult } from '../dto/payment-dtos.js';

/**
 * Lists a tenant's cash movements — the cash-flow history (Requirement 9.1,
 * 10.3).
 *
 * Supported filters are `cashId` (a single register), `type` (`INCOME` /
 * `EXPENSE`), `category` (`sale`, `opening`, …) and an inclusive `from`/`to`
 * date range; movements are returned newest-first by the repository. Pagination
 * is clamped to the platform bounds (default page size 20, max 100) via
 * {@link normalizePagination} before reaching the repository, so a hostile or
 * buggy client can never request an unbounded page.
 */
export class ListCashMovementsUseCase {
  constructor(private readonly movements: ICashMovementRepository) {}

  async execute(input: ListCashMovementsInputDto): Promise<PagedResult<CashMovementOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: CashMovementFilters = {};
    if (input.cashId !== undefined) {
      filters.cashId = input.cashId;
    }
    if (input.type !== undefined) {
      filters.type = input.type;
    }
    if (input.category !== undefined) {
      filters.category = input.category;
    }
    if (input.from !== undefined) {
      filters.from = input.from;
    }
    if (input.to !== undefined) {
      filters.to = input.to;
    }

    const query: CashMovementQuery = { page, pageSize, filters };
    const result = await this.movements.findMany(input.tenantId, query);
    return toPagedCashMovementOutput(result);
  }
}
