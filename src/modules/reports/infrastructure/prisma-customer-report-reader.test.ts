import { describe, it, expect, vi } from 'vitest';
import {
  PrismaCustomerReportReader,
  type CustomerReportPrismaClient,
  type CustomerNameRow,
  type SaleCustomerGroupRow,
} from './prisma-customer-report-reader.js';

const CURRENCY = 'ARS';

function makeClient(
  groups: SaleCustomerGroupRow[],
  names: CustomerNameRow[],
): {
  client: CustomerReportPrismaClient;
  groupBy: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
} {
  const groupBy = vi.fn(async () => groups);
  const findMany = vi.fn(async () => names);
  return {
    client: {
      sale: { groupBy },
      customer: { findMany },
    } as unknown as CustomerReportPrismaClient,
    groupBy,
    findMany,
  };
}

describe('PrismaCustomerReportReader', () => {
  const from = new Date('2024-01-01T00:00:00.000Z');
  const to = new Date('2024-01-31T23:59:59.999Z');

  it('ranks by summed total desc with a top-N take and correct scope', async () => {
    const { client, groupBy } = makeClient([], []);

    await new PrismaCustomerReportReader(client, CURRENCY).topCustomers('t1', {
      from,
      to,
      limit: 5,
    });

    const args = groupBy.mock.calls[0]![0];
    expect(args.by).toEqual(['customerId']);
    expect(args._sum).toEqual({ total: true });
    expect(args.orderBy).toEqual({ _sum: { total: 'desc' } });
    expect(args.take).toBe(5);
    expect(args.where).toEqual({
      tenantId: 't1',
      deletedAt: null,
      status: 'completed',
      saleDate: { gte: from, lte: to },
    });
  });

  it('resolves customer names for the ranked ids and maps totals to Money', async () => {
    const { client, findMany } = makeClient(
      [
        { customerId: 'c1', _sum: { total: '900.00' }, _count: 4 },
        { customerId: 'c2', _sum: { total: '100.00' }, _count: 1 },
      ],
      [
        { id: 'c1', name: 'Acme' },
        { id: 'c2', name: 'Globex' },
      ],
    );

    const result = await new PrismaCustomerReportReader(client, CURRENCY).topCustomers('t1', {
      from,
      to,
      limit: 10,
    });

    expect(findMany.mock.calls[0]![0].where).toEqual({
      tenantId: 't1',
      id: { in: ['c1', 'c2'] },
    });
    expect(result.customers).toEqual([
      { customerId: 'c1', customerName: 'Acme', salesCount: 4, totalPurchased: expect.anything() },
      { customerId: 'c2', customerName: 'Globex', salesCount: 1, totalPurchased: expect.anything() },
    ]);
    expect(result.customers[0]!.totalPurchased.toDecimalString()).toBe('900.00');
  });

  it('falls back to an empty name when the customer row is missing', async () => {
    const { client } = makeClient(
      [{ customerId: 'c1', _sum: { total: null }, _count: 0 }],
      [],
    );

    const result = await new PrismaCustomerReportReader(client, CURRENCY).topCustomers('t1', {
      from,
      to,
      limit: 10,
    });

    expect(result.customers[0]!.customerName).toBe('');
    expect(result.customers[0]!.totalPurchased.toDecimalString()).toBe('0.00');
  });

  it('short-circuits the name lookup when there are no groups', async () => {
    const { client, findMany } = makeClient([], []);

    const result = await new PrismaCustomerReportReader(client, CURRENCY).topCustomers('t1', {
      from,
      to,
      limit: 10,
    });

    expect(result.customers).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
