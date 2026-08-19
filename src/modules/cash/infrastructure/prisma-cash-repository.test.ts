import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import {
  PrismaCashRepository,
  type CashModelDelegate,
  type CashPrismaClient,
  type CashRow,
} from './prisma-cash-repository.js';
import { Cash } from '../domain/entities/cash.js';

/** A trivial Decimal stand-in mirroring Prisma's `Decimal` runtime contract. */
function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function cashRow(overrides: Partial<CashRow> = {}): CashRow {
  return {
    id: 'cash-1',
    tenantId: 't1',
    branchId: null,
    name: 'Main',
    balance: decimal('150.00'),
    ...overrides,
  };
}

function makeClient(): { client: CashPrismaClient; delegate: CashModelDelegate } {
  const delegate: CashModelDelegate = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  return { client: { cash: delegate }, delegate };
}

describe('PrismaCashRepository', () => {
  let client: CashPrismaClient;
  let delegate: CashModelDelegate;
  let repo: PrismaCashRepository;

  beforeEach(() => {
    ({ client, delegate } = makeClient());
    repo = new PrismaCashRepository(client, 'ARS');
  });

  it('maps a Decimal balance row to a Money-bearing register', async () => {
    vi.mocked(delegate.findFirst).mockResolvedValue(cashRow());

    const cash = await repo.findById('cash-1');

    expect(cash).not.toBeNull();
    expect(cash?.balance).toBeInstanceOf(Money);
    expect(cash?.balance.toDecimalString()).toBe('150.00');
    expect(cash?.balance.currency).toBe('ARS');
    expect(cash?.name).toBe('Main');
  });

  it('returns null when the register does not exist', async () => {
    vi.mocked(delegate.findFirst).mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('serialises Money to a decimal string on create', async () => {
    vi.mocked(delegate.create).mockResolvedValue(cashRow());
    const cash = Cash.create(
      {
        tenantId: 't1',
        name: 'Main',
        currency: 'ARS',
        balance: Money.fromDecimal('150.00', 'ARS'),
      },
      'cash-1',
    );

    await repo.create(cash);

    const data = vi.mocked(delegate.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({ id: 'cash-1', tenantId: 't1', name: 'Main', balance: '150.00' });
  });

  it('updates only the balance as a decimal string', async () => {
    vi.mocked(delegate.update).mockResolvedValue(cashRow());
    await repo.updateBalance('cash-1', Money.fromDecimal('42.50', 'ARS'));

    const call = vi.mocked(delegate.update).mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: 'cash-1' });
    expect(call.data).toMatchObject({ balance: '42.50' });
  });

  it('scopes list queries by tenant and paginates', async () => {
    vi.mocked(delegate.findMany).mockResolvedValue([cashRow()]);
    vi.mocked(delegate.count).mockResolvedValue(1);

    const page = await repo.findByTenant('t1', { page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(vi.mocked(delegate.findMany).mock.calls[0]![0].where).toMatchObject({ tenantId: 't1' });
  });
});
