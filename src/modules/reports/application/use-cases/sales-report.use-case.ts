import type {
  ISalesReportReader,
  SalesReportFilters,
} from '../../domain/ports/sales-report-reader.js';
import {
  resolveDateRange,
  toSalesReportOutput,
  type SalesReportInputDto,
  type SalesReportOutput,
} from '../dto/report-dtos.js';

/**
 * Produces a **sales report** for a tenant over a `[from, to]` window
 * (Requirement 10.3).
 *
 * Thin orchestration: it resolves + validates the date range (defaulting an
 * absent window and rejecting an inverted one), forwards the optional
 * customer/branch filters to the {@link ISalesReportReader} port, and maps the
 * aggregation (window totals + per-day breakdown) to a DTO with money rendered
 * as decimal strings. All aggregation happens in infrastructure.
 */
export class SalesReportUseCase {
  constructor(private readonly reader: ISalesReportReader) {}

  async execute(input: SalesReportInputDto): Promise<SalesReportOutput> {
    const range = resolveDateRange(input.from, input.to);

    const filters: SalesReportFilters = { from: range.from, to: range.to };
    if (input.customerId !== undefined) {
      filters.customerId = input.customerId;
    }
    if (input.branchId !== undefined) {
      filters.branchId = input.branchId;
    }

    const data = await this.reader.salesSummary(input.tenantId, filters);
    return toSalesReportOutput(range, data);
  }
}
