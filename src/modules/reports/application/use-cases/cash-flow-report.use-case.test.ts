import { describe, it, expect, vi } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { CashFlowReportUseCase } from './cash-flow-report.use-case.js';
import type {
  ICashFlowReportReader,
  CashFlowReportData,
  CashFlowReportFilters,
} from '../../domain/ports/cash-flow-report-reader.js';
import { InvalidDateRangeError } from '../../domain/errors/report-errors.js';

const CURRENCY = 'ARS';

function makeReader(data: CashFlowReportData): {
  reader: ICashFlowReportReader;
  cashFlow: ReturnType<typeof vi.fn>;
} {
  const cashFlow = vi.fn(
    async (_tenantId: string, _filters: CashFlowReportFilters): Promise<CashFlowReportData> => data,
  );
  return { reader: { cashFlow }, cashFlow };
}

describe('CashFlowReportUseCase', () => {
  it('maps income/expense/net and category buckets to decimal strings', async () => {
    const { reader } = makeReader({
      income: Money.fromDecimal('300.00', CURRENCY),
      expense: Money.fromDecimal('120.00', CURRENCY),
      net: Money.fromDecimal('180.00', CURRENCY),
      byCategory: [
        {
          type: 'INCOME',
          category: 'sale',
          total: Money.fromDecimal('300.00', CURRENCY),
          count: 3,
        },
        {
          type: 'EXPENSE',
          category: 'purchase',
          total: Money.fromDecimal('120.00', CURRENCY),
          count: 1,
        },
      ],
    });

    const result = await new CashFlowReportUseCase(reader).execute({
      tenantId: 't1',
      from: new Date('2024-01-01T00:00:00.000Z'),
      to: new Date('2024-01-31T00:00:00.000Z'),
    });

    expect(result.income).toBe('300.00');
    expect(result.expense).toBe('120.00');
    expect(result.net).toBe('180.00');
    expect(result.byCategory).toEqual([
      { type: 'INCOME', category: 'sale', total: '300.00', count: 3 },
      { type: 'EXPENSE', category: 'purchase', total: '120.00', count: 1 },
    ]);
  });

  it('forwards the cashId filter when provided', async () => {
    const { reader, cashFlow } = makeReader({
      income: Money.zero(CURRENCY),
      expense: Money.zero(CURRENCY),
      net: Money.zero(CURRENCY),
      byCategory: [],
    });

    await new CashFlowReportUseCase(reader).execute({
      tenantId: 't1',
      from: new Date('2024-01-01T00:00:00.000Z'),
      to: new Date('2024-01-02T00:00:00.000Z'),
      cashId: 'cash-1',
    });

    expect(cashFlow.mock.calls[0]![1]).toMatchObject({ cashId: 'cash-1' });
  });

  it('handles an empty window with zeroed totals', async () => {
    const { reader } = makeReader({
      income: Money.zero(CURRENCY),
      expense: Money.zero(CURRENCY),
      net: Money.zero(CURRENCY),
      byCategory: [],
    });

    const result = await new CashFlowReportUseCase(reader).execute({ tenantId: 't1' });

    expect(result).toMatchObject({
      income: '0.00',
      expense: '0.00',
      net: '0.00',
      byCategory: [],
    });
  });

  it('rejects an inverted date range', async () => {
    const { reader, cashFlow } = makeReader({
      income: Money.zero(CURRENCY),
      expense: Money.zero(CURRENCY),
      net: Money.zero(CURRENCY),
      byCategory: [],
    });

    await expect(
      new CashFlowReportUseCase(reader).execute({
        tenantId: 't1',
        from: new Date('2024-03-01T00:00:00.000Z'),
        to: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
    expect(cashFlow).not.toHaveBeenCalled();
  });
});
