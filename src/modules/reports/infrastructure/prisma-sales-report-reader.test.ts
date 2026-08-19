import { describe, it, expect, vi } from 'vitest';
import {
  PrismaSalesReportReader,
  type SalesReportPrismaClient,
} from './prisma-sales-report-reader.js';

const CURRENCY = 'ARS';

function makeClient(
  aggregateResult: unknown,
  rows: unknown[],
): {
  client: SalesReportPrismaClient;
  aggregate: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
} {
  const aggregate = vi.fn(async () => aggregateResult);
  const findMany = vi.fn(async () => rows);
  return {
    client: { sale: { aggregate, findMany } } as unknown as SalesReportPrismaClient,
    aggregate,
    findMany,
  };
}

describe('PrismaSalesReportReader', () => {
  const from = new Date('2024-01-01T00:00:00.000Z');
  const to = new Date('2024-01-31T23:59:59.999Z');

  it('scopes by tenant, window, completed status and soft-delete', async () => {
    const { client, aggregate, findMany } = makeClient(
      { _count: 0, _sum: { subtotal: null, taxAmount: null, total: null } },
      [],
    );

    await new PrismaSalesReportReader(client, CURRENCY).salesSummary('t1', {
      from,
      to,
      customerId: 'c1',
      branchId: 'b1',
    });

    const where = aggregate.mock.calls[0]![0].where;
    expect(where).toEqual({
      tenantId: 't1',
      deletedAt: null,
      status: 'completed',
      saleDate: { gte: from, lte: to },
      customerId: 'c1',
      branchId: 'b1',
    });
    // Daily breakdown projects only the needed columns, ordered by date.
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      select: { saleDate: true, subtotal: true, taxAmount: true, total: true },
      orderBy: { saleDate: 'asc' },
    });
  });

  it('maps aggregate Decimals to Money and zero when sums are null', async () => {
    const { client } = makeClient(
      { _count: 0, _sum: { subtotal: null, taxAmount: null, total: null } },
      [],
    );

    const result = await new PrismaSalesReportReader(client, CURRENCY).salesSummary('t1', {
      from,
      to,
    });

    expect(result.totals.count).toBe(0);
    expect(result.totals.subtotal.toDecimalString()).toBe('0.00');
    expect(result.totals.total.toDecimalString()).toBe('0.00');
    expect(result.daily).toEqual([]);
  });

  it('buckets rows by calendar day and sums each bucket', async () => {
    const { client } = makeClient(
      {
        _count: 3,
        _sum: { subtotal: '100.00', taxAmount: '21.00', total: '121.00' },
      },
      [
        { saleDate: new Date('2024-01-01T09:00:00.000Z'), subtotal: '40.00', taxAmount: '8.40', total: '48.40' },
        { saleDate: new Date('2024-01-01T18:30:00.000Z'), subtotal: '10.00', taxAmount: '2.10', total: '12.10' },
        { saleDate: new Date('2024-01-02T12:00:00.000Z'), subtotal: '50.00', taxAmount: '10.50', total: '60.50' },
      ],
    );

    const result = await new PrismaSalesReportReader(client, CURRENCY).salesSummary('t1', {
      from,
      to,
    });

    expect(result.totals.total.toDecimalString()).toBe('121.00');
    expect(result.daily).toHaveLength(2);
    const day1 = result.daily.find((d) => d.date === '2024-01-01')!;
    expect(day1.count).toBe(2);
    expect(day1.subtotal.toDecimalString()).toBe('50.00');
    expect(day1.total.toDecimalString()).toBe('60.50');
    const day2 = result.daily.find((d) => d.date === '2024-01-02')!;
    expect(day2.count).toBe(1);
    expect(day2.total.toDecimalString()).toBe('60.50');
  });
});
