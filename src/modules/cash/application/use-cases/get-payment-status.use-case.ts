import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { UUID } from '@shared/types/index.js';
import { InvalidPaymentLinkError } from '../../domain/errors/cash-errors.js';
import { derivePaymentStatus } from '../../domain/value-objects/payment-status.js';
import type { IPaymentRepository } from '../../domain/repositories/payment-repository.js';
import type { IPaymentSaleReader } from '../../domain/ports/payment-sale-reader.js';
import type { IPaymentPurchaseReader } from '../../domain/ports/payment-purchase-reader.js';
import { DEFAULT_CASH_CURRENCY } from '../dto/cash-dtos.js';
import {
  toPaymentStatusOutput,
  type GetPaymentStatusInputDto,
  type PaymentStatusOutput,
} from '../dto/payment-dtos.js';

/**
 * Computes the payment status of a sale or a purchase (Requirement 9.1).
 *
 * The status is **derived**, never stored: it is a pure function of the
 * document's billed `total` and the sum of the payments recorded against it
 * (see {@link derivePaymentStatus}) — `unpaid` when nothing is paid, `partial`
 * when some but not all is paid, `paid` once the total is met. The outstanding
 * balance (`total - paid`) is clamped at zero for display. A missing document is
 * a 404 ({@link NotFoundError}); supplying neither or both of sale/purchase is
 * an {@link InvalidPaymentLinkError}.
 */
export class GetPaymentStatusUseCase {
  constructor(
    private readonly payments: IPaymentRepository,
    private readonly saleReader: IPaymentSaleReader,
    private readonly purchaseReader: IPaymentPurchaseReader,
  ) {}

  async execute(input: GetPaymentStatusInputDto): Promise<PaymentStatusOutput> {
    const currency = input.currency ?? DEFAULT_CASH_CURRENCY;
    const saleId = input.saleId ?? null;
    const purchaseId = input.purchaseId ?? null;
    if ((saleId !== null) === (purchaseId !== null)) {
      throw new InvalidPaymentLinkError({ saleId, purchaseId });
    }

    if (saleId !== null) {
      const sale = await this.saleReader.getTotal(input.tenantId, saleId);
      if (sale === null) {
        throw NotFoundError.forEntity('Sale', saleId);
      }
      const paid = await this.payments.sumBySale(input.tenantId, saleId, currency);
      return this.buildOutput('sale', saleId, sale.total, paid, currency);
    }

    const purchaseId2 = purchaseId as UUID;
    const purchase = await this.purchaseReader.getTotal(input.tenantId, purchaseId2);
    if (purchase === null) {
      throw NotFoundError.forEntity('Purchase', purchaseId2);
    }
    const paid = await this.payments.sumByPurchase(input.tenantId, purchaseId2, currency);
    return this.buildOutput('purchase', purchaseId2, purchase.total, paid, currency);
  }

  private buildOutput(
    documentType: 'sale' | 'purchase',
    documentId: UUID,
    total: Money,
    paid: Money,
    currency: string,
  ): PaymentStatusOutput {
    const rawOutstanding = total.subtract(paid);
    const outstanding = rawOutstanding.isNegative() ? Money.zero(currency) : rawOutstanding;
    const status = derivePaymentStatus(total, paid);
    return toPaymentStatusOutput(documentType, documentId, total, paid, outstanding, status);
  }
}
