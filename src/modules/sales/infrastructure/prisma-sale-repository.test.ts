import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaSaleRepository,
  type SaleModelDelegate,
  type SalePrismaClient,
  type SaleRowWithDetails,
} from './prisma-sale-repository.js';
import { Sale } from '../domain/entities/sale.js';
import { SaleDetail } from '../domain/entities/sale-detail.js';
import { Money } from '@shared/value-objects/money.js';

/** A trivial Decimal stand-in mirroring Prisma's `Decimal` runtime contract. */
function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function saleRow(overrides: Partial<SaleRowWithDetails> = {}): SaleRowWithDetails {
  return {
    id: 'sale-1',
    tenantId: 't1',
    customerId: 'c1',
    branchId: null,
    userId: 'u1',
    saleNumber: 'SALE-000001',
    saleDate: new Date('2024-01-15T10:00:00.000Z'),
    status: 'completed',
    subtotal: decimal('250.00'),
    taxAmount: decimal('42.00'),
    total: decimal('292.00'),
    notes: null,
    details: [
      {
        id: 'line-1',
        saleId: 'sale-1',
        productId: 'p1',
        quantity: 2,
        unitPrice: decimal('100.00'),
        taxRate: decimal('21'),
        subtotal: decimal('200.00'),
        taxAmount: decimal('42.00'),
        total: decimal('242.00'),
      },
    ],
    ...overrides,
  };
}

function makeClient(): { client: SalePrismaClient; delegate: SaleModelDelegate } {
  const delegate: SaleModelDelegate = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  return { client: { sale: delegate }, delegate };
}

describe('PrismaSaleRepository', () => {
  let client: SalePrismaClient;
  let delegate: SaleModelDelegate;
  let repo: PrismaSaleRepository;

  beforeEach(() => {
    ({ client, delegate } = makeClient());
    repo = new PrismaSaleRepository(client, 'ARS');
  });

  it('maps a Decimal persistence row (with details) to a Money-bearing aggregate', async () => {
    vi.mocked(delegate.findFirst).mockResolvedValue(saleRow());

    const sale = await repo.findById('sale-1');

    expect(sale).not.toBeNull();
    expect(sale?.status).toBe('completed');
    expect(sale?.items).toHaveLength(1);
    const [line] = sale!.items;
    expect(line?.unitPrice).toBeInstanceOf(Money);
    expect(line?.unitPrice.toDecimalString()).toBe('100.00');
    expect(line?.taxRate).toBe(21);
    // Totals reconcile from the mapped lines.
    expect(sale?.subtotal.toDecimalString()).toBe('200.00');
    expect(sale?.total.toDecimalString()).toBe('242.00');
  });

  it('excludes soft-deleted rows when reading by id', async () => {
    vi.mocked(delegate.findFirst).mockResolvedValue(null);
    const sale = await repo.findById('sale-x');
    expect(sale).toBeNull();
    expect(vi.mocked(delegate.findFirst).mock.calls[0]![0].where).toMatchObject({
      id: 'sale-x',
      deletedAt: null,
    });
  });

  it('serialises Money to decimal strings and nests the detail inserts on create', async () => {
    vi.mocked(delegate.create).mockResolvedValue(saleRow());

    const sale = Sale.create({
      tenantId: 't1',
      customerId: 'c1',
      userId: 'u1',
      saleNumber: 'SALE-000001',
      currency: 'ARS',
      items: [
        SaleDetail.create({
          productId: 'p1',
          quantity: 2,
          unitPrice: Money.fromDecimal('100.00', 'ARS'),
          taxRate: 21,
        }),
      ],
    });
    sale.complete();

    await repo.create(sale);

    const data = vi.mocked(delegate.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      tenantId: 't1',
      saleNumber: 'SALE-000001',
      status: 'completed',
      subtotal: '200.00',
      taxAmount: '42.00',
      total: '242.00',
    });
    const details = (data as { details: { create: Array<Record<string, unknown>> } }).details.create;
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      productId: 'p1',
      quantity: 2,
      unitPrice: '100.00',
      subtotal: '200.00',
      taxAmount: '42.00',
      total: '242.00',
    });
  });

  it('generates a zero-padded per-tenant sale number from the current count', async () => {
    vi.mocked(delegate.count).mockResolvedValue(41);
    const number = await repo.nextSaleNumber('t1');
    expect(number).toBe('SALE-000042');
    expect(vi.mocked(delegate.count).mock.calls[0]![0].where).toMatchObject({ tenantId: 't1' });
  });
});
