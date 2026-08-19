import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type {
  IPaymentSaleReader,
  PaymentSaleTotal,
} from '../domain/ports/payment-sale-reader.js';
import type { DecimalLike } from './prisma-payment-repository.js';

/** The columns the reader projects from a `Sale` row. */
export interface SaleTotalRow {
  id: string;
  total: DecimalLike;
}

/** Minimal `sale` delegate surface used by {@link PrismaPaymentSaleReader}. */
export interface SaleTotalDelegate {
  findFirst(args: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<SaleTotalRow | null>;
}

/** A Prisma-like client exposing (at least) the `sale` delegate. */
export interface PaymentSaleReaderPrismaClient {
  sale: SaleTotalDelegate;
}

/**
 * Prisma-backed {@link IPaymentSaleReader}.
 *
 * Implements the Cash-owned sale-total port against the shared `Sale` table
 * (Dependency Inversion — Cash does not import the Sales module internals).
 * Reads only the `total` column, excludes soft-deleted sales and scopes by
 * `tenantId` for defence-in-depth (Requirement 1.5). `total` is a bare `Decimal`
 * with no currency column, so it is rehydrated into {@link Money} using the
 * configured tenant currency.
 */
export class PrismaPaymentSaleReader implements IPaymentSaleReader {
  constructor(
    private readonly prisma: PaymentSaleReaderPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async getTotal(tenantId: UUID, saleId: UUID): Promise<PaymentSaleTotal | null> {
    const row = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId, deletedAt: null },
      select: { id: true, total: true },
    });
    if (row === null) {
      return null;
    }
    return {
      saleId: row.id,
      total: Money.fromDecimal(row.total.toString(), this.currency),
    };
  }
}
