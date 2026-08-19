import { describe, it, expect, vi } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { SalesReportUseCase } from './sales-report.use-case.js';
import type {
  ISalesReportReader,
  SalesReportData,
  SalesReportFilters,
} from '../../domain/ports/sales-report-reader.js';
import { InvalidDateRangeError } from '../../domain/errors/report-errors.js';

const CURRENCY = 'ARS';

function emptyData(): SalesReportData {
  return {
    totals: {
      count: 0,
      subtotal: Money.zero(CURRENCY),
      tax: Money.zero(CURRENCY),
      total: Money.zero(CURRENCY),
    },
    daily: [],
  };
}

function makeReader(data: SalesReportData): {
  reader: ISalesReportReader;
  salesSummary: ReturnType<typeof vi.fn>;
} {
  const salesSummary = vi.fn(
    async (_tenantId: string, _filters: SalesReportFilters): Promise<SalesReportData> => data,
  );
  return { reader: { salesSummary }, salesSummary };
}

describe('SalesReportUseCase', () => {
  it('maps totals and per-day buckets to decimal-string output', async () => {
    const { reader } = makeReader({
      totals: {
        count: 2,
        subtotal: Money.fromDecimal('100.00', CURRENCY),
        tax: Money.fromDecimal('21.00', CURRENCY),
        total: Money.fromDecimal('121.00', CURRENCY),
      },
      daily: [
        {
          date: '2024-01-01',
          count: 1,
          subtotal: Money.fromDecimal('40.00', CURRENCY),
          tax: Money.fromDecimal('8.40', CURRENCY),
          total: Money.fromDecimal('48.40', CURRENCY),
        },
      ],
    });

    const result = await new SalesReportUseCase(reader).execute({
      tenantId: 't1',
      from: new Date('2024-01-01T00:00:00.000Z'),
      to: new Date('2024-01-31T00:00:00.000Z'),
    });

    expect(result.totals).toEqual({
      count: 2,
      subtotal: '100.00',
      tax: '21.00',
      total: '121.00',
    });
    expect(result.daily).toEqual([
      { date: '2024-01-01', count: 1, subtotal: '40.00', tax: '8.40', total: '48.40' },
    ]);
    expect(result.from).toBe('2024-01-01T00:00:00.000Z');
    expect(result.to).toBe('2024-01-31T00:00:00.000Z');
  });

  it('forwards optional customer and branch filters to the reader', async () => {
    const { reader, salesSummary } = makeReader(emptyData());

    await new SalesReportUseCase(reader).execute({
      tenantId: 't1',
      from: new Date('2024-01-01T00:00:00.000Z'),
      to: new Date('2024-01-02T00:00:00.000Z'),
      customerId: 'cust-1',
      branchId: 'branch-1',
    });

    const [tenantId, filters] = salesSummary.mock.calls[0]!;
    expect(tenantId).toBe('t1');
    expect(filters).toMatchObject({ customerId: 'cust-1', branchId: 'branch-1' });
  });

  it('omits filters that were not provided', async () => {
    const { reader, salesSummary } = makeReader(emptyData());

    await new SalesReportUseCase(reader).execute({
      tenantId: 't1',
      from: new Date('2024-01-01T00:00:00.000Z'),
      to: new Date('2024-01-02T00:00:00.000Z'),
    });

    const filters = salesSummary.mock.calls[0]![1];
    expect(filters).not.toHaveProperty('customerId');
    expect(filters).not.toHaveProperty('branchId');
  });

  it('defaults an absent window to the last 30 days ending now', async () => {
    const { reader, salesSummary } = makeReader(emptyData());

    const before = Date.now();
    const result = await new SalesReportUseCase(reader).execute({ tenantId: 't1' });
    const after = Date.now();

    const filters = salesSummary.mock.calls[0]![1];
    const to = filters.to.getTime();
    expect(to).toBeGreaterThanOrEqual(before);
    expect(to).toBeLessThanOrEqual(after);
    expect(to - filters.from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(result.daily).toEqual([]);
  });

  it('rejects an inverted date range', async () => {
    const { reader, salesSummary } = makeReader(emptyData());

    await expect(
      new SalesReportUseCase(reader).execute({
        tenantId: 't1',
        from: new Date('2024-02-01T00:00:00.000Z'),
        to: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
    expect(salesSummary).not.toHaveBeenCalled();
  });
});
