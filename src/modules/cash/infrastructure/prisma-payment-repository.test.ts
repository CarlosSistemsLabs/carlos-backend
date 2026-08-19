import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import {
  PrismaPaymentRepository,
  type PaymentModelDelegate,
  type PaymentPrismaClient,
  type PaymentRow,
} from './prisma-payment-repository.js';
import { Payment } from '../domain/entities/payment.js';

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay-1',
    tenantId: 't1',
    saleId: 's1',
    purchaseId: null,
    method: 'card',
    amount: decimal('100.00'),
    reference: 'auth-1',
    date: new Date('2024-03-03T00:00:00.000Z'),
    ...overrides,
  };
}

function makeClient(): { client: PaymentPrismaClient; delegate: PaymentModelDelegate } {
  const delegate: PaymentModelDelegate = {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
  };
  return { client: { payment: delegate }, delegate };
}

describe('PrismaPaymentRepository', () => {
  let client: PaymentPrismaClient;
  let delegate: PaymentModelDelegate;
  let repo: PrismaPaymentRepository;

  beforeEach(() => {
    ({ client, delegate } = makeClient());
    repo = new PrismaPaymentRepository(client, 'ARS');
  });

  it('serialises a payment to a Decimal-string row on create', async () => {
    vi.mocked(delegate.create).mockResolvedValue(paymentRow());
    const payment = Payment.create(
      {
        tenantId: 't1',
        saleId: 's1',
        method: 'card',
        amount: Money.fromDecimal('100.00', 'ARS'),
        reference: 'auth-1',
      },
      'pay-1',
    );

    await repo.create(payment);

    const data = vi.mocked(delegate.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      id: 'pay-1',
      tenantId: 't1',
      saleId: 's1',
      purchaseId: null,
      method: 'card',
      amount: '100.00',
    });
  });

  it('maps a persistence row back to a Money-bearing payment', async () => {
    vi.mocked(delegate.findMany).mockResolvedValue([
      paymentRow({ purchaseId: null, saleId: 's1' }),
    ]);
    vi.mocked(delegate.count).mockResolvedValue(1);

    const page = await repo.findMany('t1', { page: 1, pageSize: 20, filters: { saleId: 's1' } });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.amount.toDecimalString()).toBe('100.00');
    expect(page.items[0]?.isSalePayment).toBe(true);
    expect(vi.mocked(delegate.findMany).mock.calls[0]![0].where).toMatchObject({
      tenantId: 't1',
      saleId: 's1',
    });
  });

  it('sums the amount column for a sale, scoping by tenant + sale', async () => {
    vi.mocked(delegate.aggregate).mockResolvedValue({ _sum: { amount: decimal('150.00') } });

    const paid = await repo.sumBySale('t1', 's1', 'ARS');

    expect(paid.toDecimalString()).toBe('150.00');
    expect(vi.mocked(delegate.aggregate).mock.calls[0]![0]).toMatchObject({
      where: { tenantId: 't1', saleId: 's1' },
      _sum: { amount: true },
    });
  });

  it('returns zero when a purchase has no payments (null aggregate)', async () => {
    vi.mocked(delegate.aggregate).mockResolvedValue({ _sum: { amount: null } });

    const paid = await repo.sumByPurchase('t1', 'p1', 'ARS');

    expect(paid.toDecimalString()).toBe('0.00');
    expect(vi.mocked(delegate.aggregate).mock.calls[0]![0].where).toMatchObject({
      tenantId: 't1',
      purchaseId: 'p1',
    });
  });
});
