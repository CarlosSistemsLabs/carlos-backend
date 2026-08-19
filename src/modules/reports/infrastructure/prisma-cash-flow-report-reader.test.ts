import { describe, it, expect, vi } from 'vitest';
import {
  PrismaCashFlowReportReader,
  type CashFlowReportPrismaClient,
  type CashMovementGroupRow,
} from './prisma-cash-flow-report-reader.js';

const CURRENCY = 'ARS';

function makeClient(groups: CashMovementGroupRow[]): {
  client: CashFlowReportPrismaClient;
  groupBy: ReturnType<typeof vi.fn>;
} {
  const groupBy = vi.fn(async () => groups);
  return {
    client: { cashMovement: { groupBy } } as unknown as CashFlowReportPrismaClient,
    groupBy,
  };
}

describe('PrismaCashFlowReportReader', () => {
  const from = new Date('2024-01-01T00:00:00.000Z');
  const to = new Date('2024-01-31T23:59:59.999Z');

  it('groups by type + category, scoped by tenant, window and cashId', async () => {
    const { client, groupBy } = makeClient([]);

    await new PrismaCashFlowReportReader(client, CURRENCY).cashFlow('t1', {
      from,
      to,
      cashId: 'cash-1',
    });

    const args = groupBy.mock.calls[0]![0];
    expect(args.by).toEqual(['type', 'category']);
    expect(args._sum).toEqual({ amount: true });
    expect(args.where).toEqual({
      tenantId: 't1',
      date: { gte: from, lte: to },
      cashId: 'cash-1',
    });
  });

  it('folds income/expense/net from the grouped buckets', async () => {
    const { client } = makeClient([
      { type: 'INCOME', category: 'sale', _sum: { amount: '300.00' }, _count: 3 },
      { type: 'INCOME', category: 'opening', _sum: { amount: '50.00' }, _count: 1 },
      { type: 'EXPENSE', category: 'purchase', _sum: { amount: '120.00' }, _count: 2 },
    ]);

    const result = await new PrismaCashFlowReportReader(client, CURRENCY).cashFlow('t1', {
      from,
      to,
    });

    expect(result.income.toDecimalString()).toBe('350.00');
    expect(result.expense.toDecimalString()).toBe('120.00');
    expect(result.net.toDecimalString()).toBe('230.00');
    expect(result.byCategory).toHaveLength(3);
    expect(result.byCategory[0]).toMatchObject({ type: 'INCOME', category: 'sale', count: 3 });
    expect(result.byCategory[0]!.total.toDecimalString()).toBe('300.00');
  });

  it('treats a null summed amount as zero', async () => {
    const { client } = makeClient([
      { type: 'INCOME', category: 'sale', _sum: { amount: null }, _count: 0 },
    ]);

    const result = await new PrismaCashFlowReportReader(client, CURRENCY).cashFlow('t1', {
      from,
      to,
    });

    expect(result.income.toDecimalString()).toBe('0.00');
    expect(result.net.toDecimalString()).toBe('0.00');
  });

  it('returns zeroed totals for an empty window', async () => {
    const { client } = makeClient([]);

    const result = await new PrismaCashFlowReportReader(client, CURRENCY).cashFlow('t1', {
      from,
      to,
    });

    expect(result).toMatchObject({ byCategory: [] });
    expect(result.income.toDecimalString()).toBe('0.00');
    expect(result.expense.toDecimalString()).toBe('0.00');
    expect(result.net.toDecimalString()).toBe('0.00');
  });
});
