import type {
  ICashFlowReportReader,
  CashFlowReportFilters,
} from '../../domain/ports/cash-flow-report-reader.js';
import {
  resolveDateRange,
  toCashFlowReportOutput,
  type CashFlowReportInputDto,
  type CashFlowReportOutput,
} from '../dto/report-dtos.js';

/**
 * Produces a **cash-flow report** for a tenant over a `[from, to]` window:
 * income/expense sums by category plus the net delta (Requirement 10.3).
 *
 * Thin orchestration: it resolves + validates the date range, forwards the
 * optional register (`cashId`) filter to the {@link ICashFlowReportReader}
 * port, and maps the aggregation to a DTO with money as decimal strings.
 */
export class CashFlowReportUseCase {
  constructor(private readonly reader: ICashFlowReportReader) {}

  async execute(input: CashFlowReportInputDto): Promise<CashFlowReportOutput> {
    const range = resolveDateRange(input.from, input.to);

    const filters: CashFlowReportFilters = { from: range.from, to: range.to };
    if (input.cashId !== undefined) {
      filters.cashId = input.cashId;
    }

    const data = await this.reader.cashFlow(input.tenantId, filters);
    return toCashFlowReportOutput(range, data);
  }
}
