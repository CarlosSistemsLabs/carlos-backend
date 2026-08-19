import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaPurchaseRepository,
  type PurchaseModelDelegate,
  type PurchasePrismaClient,
  type PurchaseRowWithDetails,
} from './prisma-purchase-repository.js';
import { Purchase } from '../domain/entities/purchase.js';
import { PurchaseDetail } from '../domain/entities/purchase-detail.js';
import { Money } from '@shared/value-objects/money.js';

/** A trivial Decimal stand-in mirroring Prisma's `Decimal` runtime contract. */
function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function purchaseRow(overrides: Partial<PurchaseRowWithDetails> = {}): PurchaseRowWithDetails {
  return {
    id: 'purchase-1',
    tenantId: 't1',
    supplierId: 's1',
    userId: 'u1',
    purchaseNumber: 'PUR-000001',
    purchaseDate: new Date('2024-01-15T10:00:00.000Z'),
    status: 'completed',
    subtotal: decimal('250.00'),
    taxAmount: decimal('42.00'),
    total: decimal('292.00'),
    notes: null,
    details: [
      {
        id: 'line-1',
        purchaseId: 'purchase-1',
        productId: 'p1',
        quantity: 2,
        unitCost: decimal('100.00'),
        taxRate: decimal('21'),
        subtotal: decimal('200.00'),
        taxAmount: decimal('42.00'),
        total: decimal('242.00'),
      },
    ],
    ...overrides,
  };
}

function makeClient(): { client: PurchasePrismaClient; delegate: PurchaseModelDelegate } {
  const delegate: PurchaseModelDelegate = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  return { client: { purchase: delegate }, delegate };
}

describe('PrismaPurchaseRepository', () => {
  let client: PurchasePrismaClient;
  let delegate: PurchaseModelDelegate;
  let repo: PrismaPurchaseRepository;

  beforeEach(() => {
    ({ client, delegate } = makeClient());
    repo = new PrismaPurchaseRepository(client, 'ARS');
  });

  it('maps a Decimal persistence row (with details) to a Money-bearing aggregate', async () => {
    vi.mocked(delegate.findFirst).mockResolvedValue(purchaseRow());

    const purchase = await repo.findById('purchase-1');

    expect(purchase).not.toBeNull();
    expect(purchase?.status).toBe('completed');
    expect(purchase?.items).toHaveLength(1);
    const [line] = purchase!.items;
    expect(line?.unitCost).toBeInstanceOf(Money);
    expect(line?.unitCost.toDecimalString()).toBe('100.00');
    expect(line?.taxRate).toBe(21);
    // Totals reconcile from the mapped lines.
    expect(purchase?.subtotal.toDecimalString()).toBe('200.00');
    expect(purchase?.total.toDecimalString()).toBe('242.00');
  });

  it('excludes soft-deleted rows when reading by id', async () => {
    vi.mocked(delegate.findFirst).mockResolvedValue(null);
    const purchase = await repo.findById('purchase-x');
    expect(purchase).toBeNull();
    expect(vi.mocked(delegate.findFirst).mock.calls[0]![0].where).toMatchObject({
      id: 'purchase-x',
      deletedAt: null,
    });
  });

  it('serialises Money to decimal strings and nests the detail inserts on create', async () => {
    vi.mocked(delegate.create).mockResolvedValue(purchaseRow());

    const purchase = Purchase.create({
      tenantId: 't1',
      supplierId: 's1',
      userId: 'u1',
      purchaseNumber: 'PUR-000001',
      currency: 'ARS',
      items: [
        PurchaseDetail.create({
          productId: 'p1',
          quantity: 2,
          unitCost: Money.fromDecimal('100.00', 'ARS'),
          taxRate: 21,
        }),
      ],
    });
    purchase.complete();

    await repo.create(purchase);

    const data = vi.mocked(delegate.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      tenantId: 't1',
      supplierId: 's1',
      purchaseNumber: 'PUR-000001',
      status: 'completed',
      subtotal: '200.00',
      taxAmount: '42.00',
      total: '242.00',
    });
    const details = (data as { details: { create: Array<Record<string, unknown>> } }).details
      .create;
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      productId: 'p1',
      quantity: 2,
      unitCost: '100.00',
      subtotal: '200.00',
      taxAmount: '42.00',
      total: '242.00',
    });
  });

  it('generates a zero-padded per-tenant purchase number from the current count', async () => {
    vi.mocked(delegate.count).mockResolvedValue(41);
    const number = await repo.nextPurchaseNumber('t1');
    expect(number).toBe('PUR-000042');
    expect(vi.mocked(delegate.count).mock.calls[0]![0].where).toMatchObject({ tenantId: 't1' });
  });
});
