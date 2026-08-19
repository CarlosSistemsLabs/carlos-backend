import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatePurchaseUseCase } from './create-purchase.use-case.js';
import {
  EmptyPurchaseError,
  MissingProductCostError,
} from '../../domain/errors/purchase-errors.js';
import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { Purchase } from '../../domain/entities/purchase.js';
import type { IPurchaseRepository } from '../../domain/repositories/purchase-repository.js';
import type {
  IPurchaseUnitOfWork,
  PurchaseTransactionContext,
} from '../../domain/repositories/purchase-unit-of-work.js';
import type {
  IPurchaseProductReader,
  ProductCost,
} from '../../domain/ports/purchase-product-reader.js';
import type { IPurchaseSupplierReader } from '../../domain/ports/purchase-supplier-reader.js';
import type { CreatePurchaseInputDto } from '../dto/purchase-dtos.js';
import type { DomainEvent, IEventBus } from '@domain/events/index.js';
import { PurchaseCompletedEvent } from '@domain/events/index.js';

/** A fake purchase repository that records the purchase handed to `create`. */
class FakePurchaseRepository implements Partial<IPurchaseRepository> {
  public created: Purchase | null = null;
  public countCalls = 0;

  nextPurchaseNumber = vi.fn(async (): Promise<string> => {
    this.countCalls += 1;
    return `PUR-00000${this.countCalls}`;
  });

  create = vi.fn(async (purchase: Purchase): Promise<Purchase> => {
    this.created = purchase;
    return purchase;
  });
}

function cost(productId: string, unitCost: string | null, taxRate: number): ProductCost {
  return {
    productId,
    unitCost: unitCost === null ? null : Money.fromDecimal(unitCost, 'ARS'),
    taxRate,
  };
}

/** A fake event bus that records every published event (spy). */
class FakeEventBus implements IEventBus {
  public readonly published: DomainEvent[] = [];
  publish = vi.fn(async (event: DomainEvent): Promise<void> => {
    this.published.push(event);
  });
  subscribe = vi.fn(() => () => {});
}

describe('CreatePurchaseUseCase', () => {
  let repo: FakePurchaseRepository;
  let executeSpy: ReturnType<typeof vi.fn>;
  let unitOfWork: IPurchaseUnitOfWork;
  let products: { findCost: ReturnType<typeof vi.fn> } & IPurchaseProductReader;
  let suppliers: { exists: ReturnType<typeof vi.fn> } & IPurchaseSupplierReader;
  let eventBus: FakeEventBus;
  let useCase: CreatePurchaseUseCase;

  const baseInput: CreatePurchaseInputDto = {
    tenantId: 't1',
    supplierId: 's1',
    userId: 'u1',
    items: [
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ],
  };

  beforeEach(() => {
    repo = new FakePurchaseRepository();
    executeSpy = vi.fn((work: (ctx: PurchaseTransactionContext) => Promise<unknown>) =>
      work({ purchases: repo as unknown as IPurchaseRepository }),
    );
    unitOfWork = { execute: executeSpy } as unknown as IPurchaseUnitOfWork;
    products = {
      findCost: vi.fn(async (_tenantId: string, productId: string) => {
        if (productId === 'p1') return cost('p1', '100.00', 21);
        if (productId === 'p2') return cost('p2', '50.00', 0);
        return null;
      }),
    } as unknown as { findCost: ReturnType<typeof vi.fn> } & IPurchaseProductReader;
    suppliers = {
      exists: vi.fn(async () => true),
    } as unknown as { exists: ReturnType<typeof vi.fn> } & IPurchaseSupplierReader;
    eventBus = new FakeEventBus();
    useCase = new CreatePurchaseUseCase(unitOfWork, products, suppliers, eventBus);
  });

  it('computes totals from authoritative catalogue cost', async () => {
    const output = await useCase.execute(baseInput);

    // p1: 2 * 100 = 200 sub, 42 tax; p2: 1 * 50 = 50 sub, 0 tax
    expect(output.subtotal).toBe('250.00');
    expect(output.taxAmount).toBe('42.00');
    expect(output.total).toBe('292.00');
    expect(output.items).toHaveLength(2);
    expect(output.items[0]).toMatchObject({ productId: 'p1', unitCost: '100.00', total: '242.00' });
  });

  it('generates a per-tenant purchase number and persists atomically via the unit of work', async () => {
    const output = await useCase.execute(baseInput);

    expect(executeSpy).toHaveBeenCalledOnce();
    expect(repo.nextPurchaseNumber).toHaveBeenCalledWith('t1');
    expect(repo.create).toHaveBeenCalledOnce();
    expect(output.purchaseNumber).toBe('PUR-000001');
    expect(repo.created?.purchaseNumber).toBe('PUR-000001');
  });

  it('completes the purchase by default and publishes a PurchaseCompleted event', async () => {
    const output = await useCase.execute(baseInput);
    expect(output.status).toBe('completed');
    expect(repo.created?.status).toBe('completed');
    expect(repo.created?.domainEvents).toHaveLength(0);
    expect(eventBus.publish).toHaveBeenCalledOnce();
  });

  it('leaves the purchase as a draft with no event when status=draft', async () => {
    const output = await useCase.execute({ ...baseInput, status: 'draft' });
    expect(output.status).toBe('draft');
    expect(repo.created?.domainEvents).toHaveLength(0);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('publishes the buffered PurchaseCompleted event on the bus after commit', async () => {
    await useCase.execute(baseInput);

    expect(eventBus.publish).toHaveBeenCalledOnce();
    const published = eventBus.published[0];
    expect(published).toBeInstanceOf(PurchaseCompletedEvent);
    const purchaseCompleted = published as PurchaseCompletedEvent;
    expect(purchaseCompleted.tenantId).toBe('t1');
    expect(purchaseCompleted.purchaseId).toBe(repo.created?.id);
    // Contract the Stock handler consumes: {productId, quantity, branchId:null}.
    expect(purchaseCompleted.items).toEqual([
      { productId: 'p1', quantity: 2, branchId: null },
      { productId: 'p2', quantity: 1, branchId: null },
    ]);
    expect(repo.created?.domainEvents).toHaveLength(0);
  });

  it('publishes AFTER the transaction commits, never for a rolled-back purchase', async () => {
    executeSpy.mockRejectedValueOnce(new Error('tx rolled back'));

    await expect(useCase.execute(baseInput)).rejects.toThrow('tx rolled back');
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('rejects an empty item list', async () => {
    await expect(useCase.execute({ ...baseInput, items: [] })).rejects.toThrow(EmptyPurchaseError);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('throws NotFound when the supplier does not exist', async () => {
    suppliers.exists.mockResolvedValueOnce(false);
    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('throws NotFound when a product does not exist in the catalogue', async () => {
    await expect(
      useCase.execute({ ...baseInput, items: [{ productId: 'missing', quantity: 1 }] }),
    ).rejects.toThrow(NotFoundError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  describe('cost-source behavior', () => {
    it('falls back to a client-supplied unitCost when the catalogue cost is null', async () => {
      products.findCost.mockImplementation(async (_t: string, productId: string) =>
        cost(productId, null, 10),
      );

      const output = await useCase.execute({
        tenantId: 't1',
        supplierId: 's1',
        userId: 'u1',
        items: [{ productId: 'p1', quantity: 2, unitCost: '25.00' }],
      });

      // 2 * 25 = 50 sub, 10% tax = 5
      expect(output.items[0]).toMatchObject({ productId: 'p1', unitCost: '25.00' });
      expect(output.subtotal).toBe('50.00');
      expect(output.taxAmount).toBe('5.00');
      expect(output.total).toBe('55.00');
    });

    it('prefers the authoritative catalogue cost over a client-supplied override', async () => {
      // Catalogue has a cost; the client override must be ignored.
      const output = await useCase.execute({
        tenantId: 't1',
        supplierId: 's1',
        userId: 'u1',
        items: [{ productId: 'p1', quantity: 1, unitCost: '999.00' }],
      });

      expect(output.items[0]).toMatchObject({ productId: 'p1', unitCost: '100.00' });
    });

    it('throws MissingProductCostError when neither catalogue nor request supplies a cost', async () => {
      products.findCost.mockImplementation(async (_t: string, productId: string) =>
        cost(productId, null, 0),
      );

      await expect(
        useCase.execute({
          tenantId: 't1',
          supplierId: 's1',
          userId: 'u1',
          items: [{ productId: 'p1', quantity: 1 }],
        }),
      ).rejects.toThrow(MissingProductCostError);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});
