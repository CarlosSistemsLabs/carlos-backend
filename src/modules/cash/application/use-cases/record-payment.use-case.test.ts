import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { UUID, PaginatedResult } from '@shared/types/index.js';
import { RecordPaymentUseCase } from './record-payment.use-case.js';
import { PaymentOverpaymentError } from '../../domain/errors/cash-errors.js';
import { Cash } from '../../domain/entities/cash.js';
import type { CashMovement } from '../../domain/entities/cash-movement.js';
import type { Payment } from '../../domain/entities/payment.js';
import type { ICashRepository } from '../../domain/repositories/cash-repository.js';
import type {
  CashTransactionContext,
  ICashUnitOfWork,
} from '../../domain/repositories/cash-unit-of-work.js';
import type {
  IPaymentRepository,
  PaymentQuery,
} from '../../domain/repositories/payment-repository.js';
import type { ICashMovementRepository } from '../../domain/repositories/cash-movement-repository.js';
import type { IPaymentSaleReader } from '../../domain/ports/payment-sale-reader.js';
import type { IPaymentPurchaseReader } from '../../domain/ports/payment-purchase-reader.js';

const CURRENCY = 'ARS';
const TENANT = 't1';
const SALE_ID = 'sale-1';
const PURCHASE_ID = 'purchase-1';
const CASH_ID = 'cash-1';

/** In-memory payment repository recording creates and a configurable paid sum. */
class FakePaymentRepository implements IPaymentRepository {
  created: Payment[] = [];
  saleSum = Money.zero(CURRENCY);
  purchaseSum = Money.zero(CURRENCY);

  async create(payment: Payment): Promise<Payment> {
    this.created.push(payment);
    return payment;
  }
  async findMany(_tenantId: UUID, _query: PaymentQuery): Promise<PaginatedResult<Payment>> {
    return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  }
  async sumBySale(_tenantId: UUID, _saleId: UUID, _currency: string): Promise<Money> {
    return this.saleSum;
  }
  async sumByPurchase(_tenantId: UUID, _purchaseId: UUID, _currency: string): Promise<Money> {
    return this.purchaseSum;
  }
}

class FakeCashRepository implements ICashRepository {
  register: Cash | null = null;
  updatedBalance: Money | null = null;

  async findById(_id: UUID): Promise<Cash | null> {
    return this.register;
  }
  async findByTenant(): Promise<PaginatedResult<Cash>> {
    return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  }
  async create(cash: Cash): Promise<Cash> {
    return cash;
  }
  async updateBalance(_id: UUID, balance: Money): Promise<void> {
    this.updatedBalance = balance;
  }
  async save(cash: Cash): Promise<Cash> {
    return cash;
  }
}

function saleReaderReturning(total: Money | null): IPaymentSaleReader {
  return {
    getTotal: vi.fn(async (_t: UUID, saleId: UUID) =>
      total === null ? null : { saleId, total },
    ),
  };
}

function purchaseReaderReturning(total: Money | null): IPaymentPurchaseReader {
  return {
    getTotal: vi.fn(async (_t: UUID, purchaseId: UUID) =>
      total === null ? null : { purchaseId, total },
    ),
  };
}

describe('RecordPaymentUseCase', () => {
  let payments: FakePaymentRepository;
  let cashRepo: FakeCashRepository;
  let movementRepo: { create: ReturnType<typeof vi.fn> };
  let unitOfWork: ICashUnitOfWork;

  beforeEach(() => {
    payments = new FakePaymentRepository();
    cashRepo = new FakeCashRepository();
    movementRepo = { create: vi.fn(async (m: CashMovement) => m) };
    unitOfWork = {
      execute: vi.fn((work: (ctx: CashTransactionContext) => Promise<unknown>) =>
        work({
          cash: cashRepo as unknown as ICashRepository,
          movements: movementRepo as unknown as ICashMovementRepository,
          payments: payments as unknown as IPaymentRepository,
        }),
      ),
    } as unknown as ICashUnitOfWork;
  });

  function makeUseCase(
    saleTotal: Money | null = Money.fromDecimal('100.00', CURRENCY),
    purchaseTotal: Money | null = Money.fromDecimal('100.00', CURRENCY),
  ): RecordPaymentUseCase {
    return new RecordPaymentUseCase(
      payments,
      unitOfWork,
      cashRepo,
      saleReaderReturning(saleTotal),
      purchaseReaderReturning(purchaseTotal),
    );
  }

  it('records a partial payment that leaves an outstanding balance', async () => {
    const useCase = makeUseCase(Money.fromDecimal('100.00', CURRENCY));

    const out = await useCase.execute({
      tenantId: TENANT,
      userId: 'u1',
      saleId: SALE_ID,
      method: 'card',
      amount: '40.00',
    });

    expect(out.amount).toBe('40.00');
    expect(out.saleId).toBe(SALE_ID);
    expect(payments.created).toHaveLength(1);
  });

  it('allows a full payment that settles the remaining balance', async () => {
    payments.saleSum = Money.fromDecimal('60.00', CURRENCY); // already paid
    const useCase = makeUseCase(Money.fromDecimal('100.00', CURRENCY));

    const out = await useCase.execute({
      tenantId: TENANT,
      userId: 'u1',
      saleId: SALE_ID,
      method: 'transfer',
      amount: '40.00', // outstanding is exactly 40
    });

    expect(out.amount).toBe('40.00');
    expect(payments.created).toHaveLength(1);
  });

  it('rejects an overpayment that exceeds the outstanding balance', async () => {
    payments.saleSum = Money.fromDecimal('80.00', CURRENCY);
    const useCase = makeUseCase(Money.fromDecimal('100.00', CURRENCY));

    await expect(
      useCase.execute({
        tenantId: TENANT,
        userId: 'u1',
        saleId: SALE_ID,
        method: 'cash',
        amount: '25.00', // outstanding is 20
      }),
    ).rejects.toBeInstanceOf(PaymentOverpaymentError);
    expect(payments.created).toHaveLength(0);
  });

  it('books an INCOME cash movement and updates the register atomically for a cash sale payment', async () => {
    cashRepo.register = Cash.create(
      { tenantId: TENANT, name: 'Till', currency: CURRENCY, balance: Money.fromDecimal('10.00', CURRENCY) },
      CASH_ID,
    );
    const useCase = makeUseCase(Money.fromDecimal('100.00', CURRENCY));

    await useCase.execute({
      tenantId: TENANT,
      userId: 'u1',
      saleId: SALE_ID,
      method: 'cash',
      amount: '30.00',
      cashId: CASH_ID,
    });

    expect(unitOfWork.execute).toHaveBeenCalledTimes(1);
    expect(movementRepo.create).toHaveBeenCalledTimes(1);
    const movement = movementRepo.create.mock.calls[0]![0] as CashMovement;
    expect(movement.type).toBe('INCOME');
    expect(movement.category).toBe('sale');
    expect(movement.amount.toDecimalString()).toBe('30.00');
    // 10 + 30 = 40
    expect(cashRepo.updatedBalance?.toDecimalString()).toBe('40.00');
    expect(payments.created).toHaveLength(1);
  });

  it('books an EXPENSE cash movement for a cash purchase payment', async () => {
    cashRepo.register = Cash.create(
      { tenantId: TENANT, name: 'Till', currency: CURRENCY, balance: Money.fromDecimal('50.00', CURRENCY) },
      CASH_ID,
    );
    const useCase = makeUseCase(null, Money.fromDecimal('100.00', CURRENCY));

    await useCase.execute({
      tenantId: TENANT,
      userId: 'u1',
      purchaseId: PURCHASE_ID,
      method: 'cash',
      amount: '20.00',
      cashId: CASH_ID,
    });

    const movement = movementRepo.create.mock.calls[0]![0] as CashMovement;
    expect(movement.type).toBe('EXPENSE');
    expect(movement.category).toBe('purchase');
    // 50 - 20 = 30
    expect(cashRepo.updatedBalance?.toDecimalString()).toBe('30.00');
  });

  it('does NOT touch the cash register for a card payment', async () => {
    const useCase = makeUseCase(Money.fromDecimal('100.00', CURRENCY));

    await useCase.execute({
      tenantId: TENANT,
      userId: 'u1',
      saleId: SALE_ID,
      method: 'card',
      amount: '30.00',
      cashId: CASH_ID, // ignored for non-cash
    });

    expect(unitOfWork.execute).not.toHaveBeenCalled();
    expect(movementRepo.create).not.toHaveBeenCalled();
    expect(cashRepo.updatedBalance).toBeNull();
    expect(payments.created).toHaveLength(1);
  });

  it('records a cash payment without a register when no cashId is given', async () => {
    const useCase = makeUseCase(Money.fromDecimal('100.00', CURRENCY));

    await useCase.execute({
      tenantId: TENANT,
      userId: 'u1',
      saleId: SALE_ID,
      method: 'cash',
      amount: '30.00',
    });

    expect(unitOfWork.execute).not.toHaveBeenCalled();
    expect(payments.created).toHaveLength(1);
  });

  it('throws NotFound when the sale does not exist', async () => {
    const useCase = makeUseCase(null);

    await expect(
      useCase.execute({
        tenantId: TENANT,
        userId: 'u1',
        saleId: SALE_ID,
        method: 'card',
        amount: '10.00',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(payments.created).toHaveLength(0);
  });

  it('throws NotFound when a cash payment targets a missing register', async () => {
    cashRepo.register = null;
    const useCase = makeUseCase(Money.fromDecimal('100.00', CURRENCY));

    await expect(
      useCase.execute({
        tenantId: TENANT,
        userId: 'u1',
        saleId: SALE_ID,
        method: 'cash',
        amount: '10.00',
        cashId: CASH_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
