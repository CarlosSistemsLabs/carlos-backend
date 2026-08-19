import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateSaleUseCase } from './create-sale.use-case.js';
import { EmptySaleError } from '../../domain/errors/sale-errors.js';
import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { Sale } from '../../domain/entities/sale.js';
import type { ISaleRepository } from '../../domain/repositories/sale-repository.js';
import type {
  ISaleUnitOfWork,
  SaleTransactionContext,
} from '../../domain/repositories/sale-unit-of-work.js';
import type { ISaleProductReader, ProductPricing } from '../../domain/ports/sale-product-reader.js';
import type { ISaleCustomerReader } from '../../domain/ports/sale-customer-reader.js';
import type { CreateSaleInputDto } from '../dto/sale-dtos.js';
import type { DomainEvent, IEventBus } from '@domain/events/index.js';
import { SaleCompletedEvent } from '@domain/events/index.js';

/** A fake sale repository that records the sale handed to `create`. */
class FakeSaleRepository implements Partial<ISaleRepository> {
  public created: Sale | null = null;
  public countCalls = 0;

  nextSaleNumber = vi.fn(async (): Promise<string> => {
    this.countCalls += 1;
    return `SALE-00000${this.countCalls}`;
  });

  create = vi.fn(async (sale: Sale): Promise<Sale> => {
    this.created = sale;
    return sale;
  });
}

function pricing(productId: string, unitPrice: string, taxRate: number): ProductPricing {
  return { productId, unitPrice: Money.fromDecimal(unitPrice, 'ARS'), taxRate };
}

/** A fake event bus that records every published event (spy). */
class FakeEventBus implements IEventBus {
  public readonly published: DomainEvent[] = [];
  publish = vi.fn(async (event: DomainEvent): Promise<void> => {
    this.published.push(event);
  });
  subscribe = vi.fn(() => () => {});
}

describe('CreateSaleUseCase', () => {
  let repo: FakeSaleRepository;
  let executeSpy: ReturnType<typeof vi.fn>;
  let unitOfWork: ISaleUnitOfWork;
  let products: { findPricing: ReturnType<typeof vi.fn> } & ISaleProductReader;
  let customers: { exists: ReturnType<typeof vi.fn> } & ISaleCustomerReader;
  let eventBus: FakeEventBus;
  let useCase: CreateSaleUseCase;

  const baseInput: CreateSaleInputDto = {
    tenantId: 't1',
    customerId: 'c1',
    userId: 'u1',
    items: [
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ],
  };

  beforeEach(() => {
    repo = new FakeSaleRepository();
    executeSpy = vi.fn((work: (ctx: SaleTransactionContext) => Promise<unknown>) =>
      work({ sales: repo as unknown as ISaleRepository }),
    );
    unitOfWork = { execute: executeSpy } as unknown as ISaleUnitOfWork;
    products = {
      findPricing: vi.fn(async (_tenantId: string, productId: string) => {
        if (productId === 'p1') return pricing('p1', '100.00', 21);
        if (productId === 'p2') return pricing('p2', '50.00', 0);
        return null;
      }),
    } as unknown as { findPricing: ReturnType<typeof vi.fn> } & ISaleProductReader;
    customers = {
      exists: vi.fn(async () => true),
    } as unknown as { exists: ReturnType<typeof vi.fn> } & ISaleCustomerReader;
    eventBus = new FakeEventBus();
    useCase = new CreateSaleUseCase(unitOfWork, products, customers, eventBus);
  });

  it('computes totals from authoritative catalogue pricing', async () => {
    const output = await useCase.execute(baseInput);

    // p1: 2 * 100 = 200 sub, 42 tax; p2: 1 * 50 = 50 sub, 0 tax
    expect(output.subtotal).toBe('250.00');
    expect(output.taxAmount).toBe('42.00');
    expect(output.total).toBe('292.00');
    expect(output.items).toHaveLength(2);
    expect(output.items[0]).toMatchObject({ productId: 'p1', unitPrice: '100.00', total: '242.00' });
  });

  it('generates a per-tenant sale number and persists atomically via the unit of work', async () => {
    const output = await useCase.execute(baseInput);

    expect(executeSpy).toHaveBeenCalledOnce();
    expect(repo.nextSaleNumber).toHaveBeenCalledWith('t1');
    expect(repo.create).toHaveBeenCalledOnce();
    expect(output.saleNumber).toBe('SALE-000001');
    expect(repo.created?.saleNumber).toBe('SALE-000001');
  });

  it('completes the sale by default and publishes a SaleCompleted event', async () => {
    const output = await useCase.execute(baseInput);
    expect(output.status).toBe('completed');
    expect(repo.created?.status).toBe('completed');
    // The buffered event is drained after publication (asserted in detail below),
    // so nothing lingers on the aggregate to be re-published.
    expect(repo.created?.domainEvents).toHaveLength(0);
    expect(eventBus.publish).toHaveBeenCalledOnce();
  });

  it('leaves the sale as a draft with no event when status=draft', async () => {
    const output = await useCase.execute({ ...baseInput, status: 'draft' });
    expect(output.status).toBe('draft');
    expect(repo.created?.domainEvents).toHaveLength(0);
  });

  it('publishes the buffered SaleCompleted event on the bus after commit', async () => {
    await useCase.execute(baseInput);

    expect(eventBus.publish).toHaveBeenCalledOnce();
    const published = eventBus.published[0];
    expect(published).toBeInstanceOf(SaleCompletedEvent);
    const saleCompleted = published as SaleCompletedEvent;
    expect(saleCompleted.tenantId).toBe('t1');
    expect(saleCompleted.saleId).toBe(repo.created?.id);
    // Contract matches what the Stock handler consumes: {productId, quantity, branchId}.
    expect(saleCompleted.items).toEqual([
      { productId: 'p1', quantity: 2, branchId: null },
      { productId: 'p2', quantity: 1, branchId: null },
    ]);
    // Buffer is drained so a later republication cannot double-decrement stock.
    expect(repo.created?.domainEvents).toHaveLength(0);
  });

  it('publishes nothing for a draft sale (no completion event buffered)', async () => {
    await useCase.execute({ ...baseInput, status: 'draft' });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('publishes AFTER the transaction commits, never for a rolled-back sale', async () => {
    // The unit of work rejects (transaction rolls back) before returning a sale.
    executeSpy.mockRejectedValueOnce(new Error('tx rolled back'));

    await expect(useCase.execute(baseInput)).rejects.toThrow('tx rolled back');
    // No event is published because publication happens post-commit only.
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('rejects an empty item list', async () => {
    await expect(useCase.execute({ ...baseInput, items: [] })).rejects.toThrow(EmptySaleError);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('throws NotFound when the customer does not exist', async () => {
    customers.exists.mockResolvedValueOnce(false);
    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('throws NotFound when a product has no pricing', async () => {
    await expect(
      useCase.execute({ ...baseInput, items: [{ productId: 'missing', quantity: 1 }] }),
    ).rejects.toThrow(NotFoundError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
