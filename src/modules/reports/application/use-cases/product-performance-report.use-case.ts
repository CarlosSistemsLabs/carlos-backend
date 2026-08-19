import type { IProductPerformanceReader } from '../../domain/ports/product-performance-reader.js';
import {
  normalizeLimit,
  resolveDateRange,
  toProductPerformanceReportOutput,
  type ProductPerformanceReportInputDto,
  type ProductPerformanceReportOutput,
} from '../dto/report-dtos.js';

/**
 * Produces a **product-performance report** for a tenant: the best-selling
 * products ranked by quantity sold / revenue over a `[from, to]` window
 * (Requirement 10.3).
 *
 * Thin orchestration: it resolves + validates the date range, clamps the top-N
 * `limit`, forwards to the {@link IProductPerformanceReader} port, and maps the
 * ranking to a DTO with money as decimal strings.
 */
export class ProductPerformanceReportUseCase {
  constructor(private readonly reader: IProductPerformanceReader) {}

  async execute(
    input: ProductPerformanceReportInputDto,
  ): Promise<ProductPerformanceReportOutput> {
    const range = resolveDateRange(input.from, input.to);
    const limit = normalizeLimit(input.limit);

    const data = await this.reader.productPerformance(input.tenantId, {
      from: range.from,
      to: range.to,
      limit,
    });
    return toProductPerformanceReportOutput(range, data);
  }
}
