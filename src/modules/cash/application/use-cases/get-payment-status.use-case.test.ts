import { describe, it, expect, vi } from 'vitest';
import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { UUID, PaginatedResult } from '@shared/types/index.js';
import { GetPaymentStatusUseCase } from './get-payment-status.use-case.js';
import { InvalidPaymentLinkError } from '../../domain/errors/cash-errors.js';
import type { Payment } from '../../domain/entities/payment.js';
import type {
  IPaymentRepository,
  PaymentQuery,
} from '../../domain/repositories/payment-repository.js';
import type { IPaymentSaleReader } from '../../domain/ports/payment-sale-reader.js';
import type { IPaymentPurchaseReader } from '../../domain/ports/payment-purchase-reader.js';

const CURRENCY = 'ARS';
const TENANT = 't1';
const SALE_ID = 'sale-1';

class FakePaymentRepository implements IPaymentRepository {
  saleSum = Money.zero(CURRENCY);
  async create(payment: Payment): Promise<Payment> {
    return payment;
  }
  async findMany(_tenantId: UUID, _query: PaymentQuery): Promise<PaginatedResult<Payment>> {
    return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  }
  async sumBySale(): Promise<Money> {
    return this.saleSum;
  }
  async sumByPurchase(): Promise<Money> {
    return Money.zero(CURRENCY);
  }
}

function saleReader(total: Money | null): IPaymentSaleReader {
  return { getTotal: vi.fn(async (_t: UUID, saleId: UUID) => (total === null ? null : { saleId, total })) };
}

const purchaseReader: IPaymentPurchaseReader = {
  getTotal: vi.fn(async () => null),
};

function makeUseCase(repo: FakePaymentRepository, saleTotal: Money | null): GetPaymentStatusUseCase {
  return new GetPaymentStatusUseCase(repo, saleReader(saleTotal), purchaseReader);
}

describe('GetPaymentStatusUseCase', () => {
  it('reports unpaid when nothing has been paid', async () => {
    const repo = new FakePaymentRepository();
    repo.saleSum = Money.zero(CURRENCY);
    const out = await makeUseCase(repo, Money.fromDecimal('100.00', CURRENCY)).execute({
      tenantId: TENANT,
      saleId: SALE_ID,
    });

    expect(out.status).toBe('unpaid');
    expect(out.total).toBe('100.00');
    expect(out.paid).toBe('0.00');
    expect(out.outstanding).toBe('100.00');
    expect(out.documentType).toBe('sale');
  });

  it('reports partial when some but not all is paid', async () => {
    const repo = new FakePaymentRepository();
    repo.saleSum = Money.fromDecimal('40.00', CURRENCY);
    const out = await makeUseCase(repo, Money.fromDecimal('100.00', CURRENCY)).execute({
      tenantId: TENANT,
      saleId: SALE_ID,
    });

    expect(out.status).toBe('partial');
    expect(out.paid).toBe('40.00');
    expect(out.outstanding).toBe('60.00');
  });

  it('reports paid once the total is met', async () => {
    const repo = new FakePaymentRepository();
    repo.saleSum = Money.fromDecimal('100.00', CURRENCY);
    const out = await makeUseCase(repo, Money.fromDecimal('100.00', CURRENCY)).execute({
      tenantId: TENANT,
      saleId: SALE_ID,
    });

    expect(out.status).toBe('paid');
    expect(out.outstanding).toBe('0.00');
  });

  it('throws NotFound when the sale does not exist', async () => {
    const repo = new FakePaymentRepository();
    await expect(
      makeUseCase(repo, null).execute({ tenantId: TENANT, saleId: SALE_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a request with neither sale nor purchase', async () => {
    const repo = new FakePaymentRepository();
    await expect(
      makeUseCase(repo, Money.fromDecimal('100.00', CURRENCY)).execute({ tenantId: TENANT }),
    ).rejects.toBeInstanceOf(InvalidPaymentLinkError);
  });

  it('rejects a request with both sale and purchase', async () => {
    const repo = new FakePaymentRepository();
    await expect(
      makeUseCase(repo, Money.fromDecimal('100.00', CURRENCY)).execute({
        tenantId: TENANT,
        saleId: SALE_ID,
        purchaseId: 'purchase-1',
      }),
    ).rejects.toBeInstanceOf(InvalidPaymentLinkError);
  });
});
