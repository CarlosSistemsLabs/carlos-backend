import { describe, it, expect, vi } from 'vitest';
import {
  PrismaPaymentSaleReader,
  type PaymentSaleReaderPrismaClient,
} from './prisma-payment-sale-reader.js';
import {
  PrismaPaymentPurchaseReader,
  type PaymentPurchaseReaderPrismaClient,
} from './prisma-payment-purchase-reader.js';

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

describe('PrismaPaymentSaleReader', () => {
  it('reads the sale total and maps it to Money, scoped by tenant and not deleted', async () => {
    const findFirst = vi.fn(async (_args: { where?: unknown; select?: unknown }) => ({
      id: 's1',
      total: decimal('250.00'),
    }));
    const client = { sale: { findFirst } } as unknown as PaymentSaleReaderPrismaClient;
    const reader = new PrismaPaymentSaleReader(client, 'ARS');

    const result = await reader.getTotal('t1', 's1');

    expect(result?.saleId).toBe('s1');
    expect(result?.total.toDecimalString()).toBe('250.00');
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 's1', tenantId: 't1', deletedAt: null },
      select: { id: true, total: true },
    });
  });

  it('returns null when the sale is missing', async () => {
    const client = {
      sale: { findFirst: vi.fn(async () => null) },
    } as unknown as PaymentSaleReaderPrismaClient;
    const reader = new PrismaPaymentSaleReader(client, 'ARS');

    expect(await reader.getTotal('t1', 'missing')).toBeNull();
  });
});

describe('PrismaPaymentPurchaseReader', () => {
  it('reads the purchase total and maps it to Money', async () => {
    const findFirst = vi.fn(async (_args: { where?: unknown; select?: unknown }) => ({
      id: 'p1',
      total: decimal('99.90'),
    }));
    const client = { purchase: { findFirst } } as unknown as PaymentPurchaseReaderPrismaClient;
    const reader = new PrismaPaymentPurchaseReader(client, 'ARS');

    const result = await reader.getTotal('t1', 'p1');

    expect(result?.purchaseId).toBe('p1');
    expect(result?.total.toDecimalString()).toBe('99.90');
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'p1', tenantId: 't1', deletedAt: null },
    });
  });

  it('returns null when the purchase is missing', async () => {
    const client = {
      purchase: { findFirst: vi.fn(async () => null) },
    } as unknown as PaymentPurchaseReaderPrismaClient;
    const reader = new PrismaPaymentPurchaseReader(client, 'ARS');

    expect(await reader.getTotal('t1', 'missing')).toBeNull();
  });
});
