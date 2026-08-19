import { describe, it, expect, vi } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { CustomerReportUseCase } from './customer-report.use-case.js';
import type {
  ICustomerReportReader,
  CustomerReportData,
  CustomerReportFilters,
} from '../../domain/ports/customer-report-reader.js';
import { InvalidDateRangeError } from '../../domain/errors/report-errors.js';

const CURRENCY = 'ARS';

function makeReader(data: CustomerReportData): {
  reader: ICustomerReportReader;
  topCustomers: ReturnType<typeof vi.fn>;
} {
  const topCustomers = vi.fn(
    async (_tenantId: string, _filters: CustomerReportFilters): Promise<CustomerReportData> => data,
  );
  return { reader: { topCustomers }, topCustomers };
}

describe('CustomerReportUseCase', () => {
  it('maps ranked customers to decimal-string output', async () => {
    const { reader } = makeReader({
      customers: [
        {
          customerId: 'c1',
          customerName: 'Acme',
          salesCount: 4,
          totalPurchased: Money.fromDecimal('999.99', CURRENCY),
        },
      ],
    });

    const result = await new CustomerReportUseCase(reader).execute({ tenantId: 't1' });

    expect(result.customers).toEqual([
      { customerId: 'c1', customerName: 'Acme', salesCount: 4, totalPurchased: '999.99' },
    ]);
  });

  it('defaults the limit to 10 when not provided', async () => {
    const { reader, topCustomers } = makeReader({ customers: [] });

    await new CustomerReportUseCase(reader).execute({ tenantId: 't1' });

    expect(topCustomers.mock.calls[0]![1]).toMatchObject({ limit: 10 });
  });

  it('clamps an oversized limit to the maximum', async () => {
    const { reader, topCustomers } = makeReader({ customers: [] });

    await new CustomerReportUseCase(reader).execute({ tenantId: 't1', limit: 10_000 });

    expect(topCustomers.mock.calls[0]![1]).toMatchObject({ limit: 100 });
  });

  it('clamps a non-positive limit up to 1', async () => {
    const { reader, topCustomers } = makeReader({ customers: [] });

    await new CustomerReportUseCase(reader).execute({ tenantId: 't1', limit: 0 });

    expect(topCustomers.mock.calls[0]![1]).toMatchObject({ limit: 1 });
  });

  it('rejects an inverted date range', async () => {
    const { reader, topCustomers } = makeReader({ customers: [] });

    await expect(
      new CustomerReportUseCase(reader).execute({
        tenantId: 't1',
        from: new Date('2024-05-01T00:00:00.000Z'),
        to: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
    expect(topCustomers).not.toHaveBeenCalled();
  });
});
