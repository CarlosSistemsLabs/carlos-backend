import type {
  IPaymentRepository,
  PaymentFilters,
  PaymentQuery,
} from '../../domain/repositories/payment-repository.js';
import {
  normalizePagination,
  toPagedPaymentOutput,
  type ListPaymentsInputDto,
  type PagedResult,
  type PaymentOutput,
} from '../dto/payment-dtos.js';

/**
 * Lists a tenant's payments with pagination and filtering (Requirement 9.1).
 *
 * Supported filters are `saleId`, `purchaseId`, `method` and an inclusive
 * `from`/`to` date range; payments are returned newest-first by the repository.
 * Pagination is clamped to the platform bounds (default page size 20, max 100)
 * via {@link normalizePagination} before reaching the repository, so a hostile
 * or buggy client can never request an unbounded page.
 */
export class ListPaymentsUseCase {
  constructor(private readonly payments: IPaymentRepository) {}

  async execute(input: ListPaymentsInputDto): Promise<PagedResult<PaymentOutput>> {
    const { page, pageSize } = normalizePagination(input.page, input.pageSize);

    const filters: PaymentFilters = {};
    if (input.saleId !== undefined) {
      filters.saleId = input.saleId;
    }
    if (input.purchaseId !== undefined) {
      filters.purchaseId = input.purchaseId;
    }
    if (input.method !== undefined) {
      filters.method = input.method;
    }
    if (input.from !== undefined) {
      filters.from = input.from;
    }
    if (input.to !== undefined) {
      filters.to = input.to;
    }

    const query: PaymentQuery = { page, pageSize, filters };
    const result = await this.payments.findMany(input.tenantId, query);
    return toPagedPaymentOutput(result);
  }
}
