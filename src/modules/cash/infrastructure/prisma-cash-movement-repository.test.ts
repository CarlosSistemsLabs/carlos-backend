import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import {
  PrismaCashMovementRepository,
  type CashMovementModelDelegate,
  type CashMovementPrismaClient,
  type CashMovementRow,
} from './prisma-cash-movement-repository.js';
import { CashMovement } from '../domain/entities/cash-movement.js';

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function movementRow(overrides: Partial<CashMovementRow> = {}): CashMovementRow {
  return {
    id: 'm1',
    cashId: 'cash-1',
    tenantId: 't1',
    userId: 'u1',
    type: 'INCOME',
    category: 'opening',
    amount: decimal('100.00'),
    reference: null,
    description: 'Opening balance',
    date: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeClient(): {
  client: CashMovementPrismaClient;
  delegate: CashMovementModelDelegate;
} {
  const delegate: CashMovementModelDelegate = {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  };
  return { client: { cashMovement: delegate }, delegate };
}

describe('PrismaCashMovementRepository', () => {
  let client: CashMovementPrismaClient;
  let delegate: CashMovementModelDelegate;
  let repo: PrismaCashMovementRepository;

  beforeEach(() => {
    ({ client, delegate } = makeClient());
    repo = new PrismaCashMovementRepository(client, 'ARS');
  });

  it('serialises a movement to a Decimal-string row on create', async () => {
    vi.mocked(delegate.create).mockResolvedValue(movementRow());
    const movement = CashMovement.create(
      {
        cashId: 'cash-1',
        tenantId: 't1',
        userId: 'u1',
        type: 'INCOME',
        category: 'opening',
        amount: Money.fromDecimal('100.00', 'ARS'),
        description: 'Opening balance',
      },
      'm1',
    );

    await repo.create(movement);

    const data = vi.mocked(delegate.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      id: 'm1',
      cashId: 'cash-1',
      type: 'INCOME',
      category: 'opening',
      amount: '100.00',
    });
  });

  it('maps a persistence row back to a Money-bearing movement', async () => {
    vi.mocked(delegate.findMany).mockResolvedValue([movementRow()]);
    vi.mocked(delegate.count).mockResolvedValue(1);

    const page = await repo.findMany('t1', { page: 1, pageSize: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.amount.toDecimalString()).toBe('100.00');
    expect(page.items[0]?.category).toBe('opening');
  });

  it('nets INCOME against EXPENSE in sumByCash using signed Money math', async () => {
    vi.mocked(delegate.findMany).mockResolvedValue([
      movementRow({ id: 'a', type: 'INCOME', amount: decimal('100.00') }),
      movementRow({ id: 'b', type: 'INCOME', amount: decimal('0.05') }),
      movementRow({ id: 'c', type: 'EXPENSE', amount: decimal('30.00') }),
    ]);

    const total = await repo.sumByCash('t1', 'cash-1', 'ARS');

    // 100.00 + 0.05 - 30.00 = 70.05
    expect(total.toDecimalString()).toBe('70.05');
    expect(vi.mocked(delegate.findMany).mock.calls[0]![0].where).toMatchObject({
      tenantId: 't1',
      cashId: 'cash-1',
    });
  });

  it('translates a date range filter to gte/lte on date', async () => {
    vi.mocked(delegate.findMany).mockResolvedValue([]);
    vi.mocked(delegate.count).mockResolvedValue(0);
    const from = new Date('2024-01-01T00:00:00.000Z');
    const to = new Date('2024-01-31T00:00:00.000Z');

    await repo.findMany('t1', {
      page: 1,
      pageSize: 20,
      filters: { cashId: 'cash-1', type: 'EXPENSE', category: 'closing', from, to },
    });

    expect(vi.mocked(delegate.findMany).mock.calls[0]![0].where).toMatchObject({
      tenantId: 't1',
      cashId: 'cash-1',
      type: 'EXPENSE',
      category: 'closing',
      date: { gte: from, lte: to },
    });
  });
});
