import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { UUID } from '@shared/types/index.js';
import { Payment } from '../../domain/entities/payment.js';
import { CashMovement } from '../../domain/entities/cash-movement.js';
import { PaymentOverpaymentError } from '../../domain/errors/cash-errors.js';
import type { ICashRepository } from '../../domain/repositories/cash-repository.js';
import type { ICashUnitOfWork } from '../../domain/repositories/cash-unit-of-work.js';
import type { IPaymentRepository } from '../../domain/repositories/payment-repository.js';
import type { IPaymentSaleReader } from '../../domain/ports/payment-sale-reader.js';
import type { IPaymentPurchaseReader } from '../../domain/ports/payment-purchase-reader.js';
import { DEFAULT_CASH_CURRENCY } from '../dto/cash-dtos.js';
import { toPaymentOutput, type PaymentOutput, type RecordPaymentInputDto } from '../dto/payment-dtos.js';

/**
 * Records a payment against a sale or a purchase (Requirement 9.1).
 *
 * Responsibilities:
 * 1. Build the {@link Payment} (the entity enforces the *exactly one of
 *    sale/purchase* link rule and the strictly-positive amount).
 * 2. Verify the referenced document exists for the tenant via the appropriate
 *    reader port; a missing sale/purchase is a 404 ({@link NotFoundError}).
 * 3. Compute the outstanding balance (`total - alreadyPaid`) and **reject
 *    overpayment**: an amount greater than the outstanding balance raises a
 *    {@link PaymentOverpaymentError} so the payments of a document can never
 *    exceed its billed total.
 * 4. Persist the payment. For a `cash` payment **with** a `cashId`, also book a
 *    register {@link CashMovement} (INCOME/`sale` for a sale, EXPENSE/`purchase`
 *    for a purchase) and update the register balance — all in a single
 *    transaction ({@link ICashUnitOfWork}) so payment + movement + balance land
 *    together or not at all.
 *
 * **Cash-register linkage rule.** Only a `cash` payment can move the till, and
 * only when a `cashId` is supplied. `card` / `transfer` / `check` payments (and
 * cash payments recorded without a register) never touch the cash register —
 * they settle the document but leave the drawer balance untouched.
 *
 * All amounts are denominated in the working currency (`input.currency`, or the
 * tenant base currency), which must match the currency the readers and payment
 * repository are configured with.
 */
export class RecordPaymentUseCase {
  constructor(
    private readonly payments: IPaymentRepository,
    private readonly unitOfWork: ICashUnitOfWork,
    private readonly cashRepository: ICashRepository,
    private readonly saleReader: IPaymentSaleReader,
    private readonly purchaseReader: IPaymentPurchaseReader,
  ) {}

  async execute(input: RecordPaymentInputDto): Promise<PaymentOutput> {
    const currency = input.currency ?? DEFAULT_CASH_CURRENCY;
    const amount = Money.fromDecimal(input.amount, currency);

    // The entity enforces the link rule and positive amount up front.
    const payment = Payment.create({
      tenantId: input.tenantId,
      saleId: input.saleId ?? null,
      purchaseId: input.purchaseId ?? null,
      method: input.method,
      amount,
      reference: input.reference ?? null,
      ...(input.date !== undefined ? { date: input.date } : {}),
    });

    // Verify the document exists and read its billed total + already-paid sum.
    const { total, alreadyPaid } = await this.resolveBalances(payment, currency);
    const outstanding = total.subtract(alreadyPaid);

    if (amount.greaterThan(outstanding)) {
      throw new PaymentOverpaymentError(
        amount.toDecimalString(),
        outstanding.isNegative() ? Money.zero(currency).toDecimalString() : outstanding.toDecimalString(),
        currency,
      );
    }

    // A cash payment tied to a register moves the till atomically with the
    // payment; every other case is a plain payment insert.
    const cashId = payment.method === 'cash' ? (input.cashId ?? null) : null;
    if (cashId === null) {
      const persisted = await this.payments.create(payment);
      return toPaymentOutput(persisted);
    }

    return this.recordWithCashMovement(payment, cashId, input.userId, amount);
  }

  /** Loads the document total and the amount already paid against it. */
  private async resolveBalances(
    payment: Payment,
    currency: string,
  ): Promise<{ total: Money; alreadyPaid: Money }> {
    if (payment.isSalePayment) {
      const saleId = payment.saleId as UUID;
      const sale = await this.saleReader.getTotal(payment.tenantId, saleId);
      if (sale === null) {
        throw NotFoundError.forEntity('Sale', saleId);
      }
      const alreadyPaid = await this.payments.sumBySale(payment.tenantId, saleId, currency);
      return { total: sale.total, alreadyPaid };
    }

    const purchaseId = payment.purchaseId as UUID;
    const purchase = await this.purchaseReader.getTotal(payment.tenantId, purchaseId);
    if (purchase === null) {
      throw NotFoundError.forEntity('Purchase', purchaseId);
    }
    const alreadyPaid = await this.payments.sumByPurchase(payment.tenantId, purchaseId, currency);
    return { total: purchase.total, alreadyPaid };
  }

  /**
   * Persists the payment together with the register movement it triggers,
   * updating the register balance — all in one transaction.
   */
  private async recordWithCashMovement(
    payment: Payment,
    cashId: UUID,
    userId: UUID,
    amount: Money,
  ): Promise<PaymentOutput> {
    const cash = await this.cashRepository.findById(cashId);
    if (cash === null || cash.tenantId !== payment.tenantId) {
      throw NotFoundError.forEntity('Cash', cashId);
    }

    // A sale payment is money in (INCOME); a purchase payment is money out
    // (EXPENSE). The category records the business origin of the movement.
    const isSale = payment.isSalePayment;
    const movement = CashMovement.create({
      cashId: cash.id,
      tenantId: payment.tenantId,
      userId,
      type: isSale ? 'INCOME' : 'EXPENSE',
      category: isSale ? 'sale' : 'purchase',
      amount,
      reference: payment.reference,
      description: isSale ? 'Sale payment received' : 'Purchase payment made',
      date: payment.date,
    });
    cash.applyMovement(movement);

    const persisted = await this.unitOfWork.execute(async ({ cash: cashRepo, movements, payments }) => {
      const created = await payments.create(payment);
      await movements.create(movement);
      await cashRepo.updateBalance(cash.id, cash.balance);
      return created;
    });

    return toPaymentOutput(persisted);
  }
}
