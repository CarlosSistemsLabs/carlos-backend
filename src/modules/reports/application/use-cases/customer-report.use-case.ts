import type { ICustomerReportReader } from '../../domain/ports/customer-report-reader.js';
import {
  normalizeLimit,
  resolveDateRange,
  toCustomerReportOutput,
  type CustomerReportInputDto,
  type CustomerReportOutput,
} from '../dto/report-dtos.js';

/**
 * Produces a **customer report** for a tenant: the top customers ranked by
 * total purchased over a `[from, to]` window (Requirement 10.3).
 *
 * Thin orchestration: it resolves + validates the date range, clamps the top-N
 * `limit` into a safe bound, forwards to the {@link ICustomerReportReader} port,
 * and maps the ranking to a DTO with money as decimal strings.
 */
export class CustomerReportUseCase {
  constructor(private readonly reader: ICustomerReportReader) {}

  async execute(input: CustomerReportInputDto): Promise<CustomerReportOutput> {
    const range = resolveDateRange(input.from, input.to);
    const limit = normalizeLimit(input.limit);

    const data = await this.reader.topCustomers(input.tenantId, {
      from: range.from,
      to: range.to,
      limit,
    });
    return toCustomerReportOutput(range, data);
  }
}
