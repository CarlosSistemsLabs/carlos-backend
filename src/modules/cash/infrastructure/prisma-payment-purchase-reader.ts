import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type {
  IPaymentPurchaseReader,
  PaymentPurchaseTotal,
} from '../domain/ports/payment-purchase-reader.js';
import type { DecimalLike } from './prisma-payment-repository.js';

/** The columns the reader projects from a `Purchase` row. */
export interface PurchaseTotalRow {
  id: string;
  total: DecimalLike;
}

/** Minimal `purchase` delegate surface used by {@link PrismaPaymentPurchaseReader}. */
export interface PurchaseTotalDelegate {
  findFirst(args: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<PurchaseTotalRow | null>;
}

/** A Prisma-like client exposing (at least) the `purchase` delegate. */
export interface PaymentPurchaseReaderPrismaClient {
  purchase: PurchaseTotalDelegate;
}

/**
 * Prisma-backed {@link IPaymentPurchaseReader}.
 *
 * Implements the Cash-owned purchase-total port against the shared `Purchase`
 * table (Dependency Inversion — Cash does not import the Purchases module
 * internals). Reads only the `total` column, excludes soft-deleted purchases and
 * scopes by `tenantId` for defence-in-depth (Requirement 1.5). `total` is a bare
 * `Decimal` with no currency column, so it is rehydrated into {@link Money}
 * using the configured tenant currency.
 */
export class PrismaPaymentPurchaseReader implements IPaymentPurchaseReader {
  constructor(
    private readonly prisma: PaymentPurchaseReaderPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async getTotal(tenantId: UUID, purchaseId: UUID): Promise<PaymentPurchaseTotal | null> {
    const row = await this.prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId, deletedAt: null },
      select: { id: true, total: true },
    });
    if (row === null) {
      return null;
    }
    return {
      purchaseId: row.id,
      total: Money.fromDecimal(row.total.toString(), this.currency),
    };
  }
}
