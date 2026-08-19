import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import type { UUID, PaginatedResult } from '@shared/types/index.js';
import { ListPaymentsUseCase } from './list-payments.use-case.js';
import { Payment } from '../../domain/entities/payment.js';
import type {
  IPaymentRepository,
  PaymentQuery,
} from '../../domain/repositories/payment-repository.js';

const CURRENCY = 'ARS';

function samplePayment(): Payment {
  return Payment.create(
    {
      tenantId: 't1',
      saleId: 'sale-1',
      method: 'cash',
      amount: Money.fromDecimal('10.00', CURRENCY),
    },
    'pay-1',
  );
}

describe('ListPaymentsUseCase', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let repo: IPaymentRepository;
  let useCase: ListPaymentsUseCase;

  beforeEach(() => {
    findMany = vi.fn(
      async (_tenantId: UUID, _query: PaymentQuery): Promise<PaginatedResult<Payment>> => ({
        items: [samplePayment()],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      }),
    );
    repo = {
      create: vi.fn(),
      findMany,
      sumBySale: vi.fn(),
      sumByPurchase: vi.fn(),
    } as unknown as IPaymentRepository;
    useCase = new ListPaymentsUseCase(repo);
  });

  it('passes through filters and returns a projected page', async () => {
    const from = new Date('2024-01-01T00:00:00.000Z');
    const to = new Date('2024-02-01T00:00:00.000Z');

    const page = await useCase.execute({
      tenantId: 't1',
      saleId: 'sale-1',
      method: 'cash',
      from,
      to,
      page: 2,
      pageSize: 10,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.method).toBe('cash');
    expect(page.meta).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });

    const [tenantId, query] = findMany.mock.calls[0]!;
    expect(tenantId).toBe('t1');
    expect(query).toMatchObject({
      page: 2,
      pageSize: 10,
      filters: { saleId: 'sale-1', method: 'cash', from, to },
    });
  });

  it('clamps an oversized pageSize to the platform maximum', async () => {
    await useCase.execute({ tenantId: 't1', pageSize: 10_000 });

    expect(findMany.mock.calls[0]![1]).toMatchObject({ page: 1, pageSize: 100 });
  });

  it('defaults pagination when none is supplied', async () => {
    await useCase.execute({ tenantId: 't1' });

    expect(findMany.mock.calls[0]![1]).toMatchObject({ page: 1, pageSize: 20, filters: {} });
  });
});
