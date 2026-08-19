import type {
  IStockReportReader,
  StockReportFilters,
} from '../../domain/ports/stock-report-reader.js';
import {
  toStockReportOutput,
  type StockReportInputDto,
  type StockReportOutput,
} from '../dto/report-dtos.js';

/**
 * Produces a **stock report** for a tenant: current stock levels plus low-stock
 * alerts (items at or below their `minStock` threshold) (Requirement 10.3).
 *
 * Thin orchestration: it forwards the optional branch filter to the
 * {@link IStockReportReader} port and maps the aggregation to a DTO. The
 * low-stock determination (`quantity <= minStock`) lives in the reader, which
 * has the joined product threshold to hand.
 */
export class StockReportUseCase {
  constructor(private readonly reader: IStockReportReader) {}

  async execute(input: StockReportInputDto): Promise<StockReportOutput> {
    const filters: StockReportFilters = {};
    if (input.branchId !== undefined) {
      filters.branchId = input.branchId;
    }

    const data = await this.reader.stockLevels(input.tenantId, filters);
    return toStockReportOutput(data);
  }
}
