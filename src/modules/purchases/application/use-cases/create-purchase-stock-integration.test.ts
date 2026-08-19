import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryEventBus } from '@infrastructure/events/in-memory-event-bus.js';
import { Money } from '@shared/value-objects/money.js';
import {
  AdjustStockUseCase,
  RecordStockMovementUseCase,
  StockEventHandlers,
  Stock,
  type StockEventLogger,
  type IStockRepository,
  type IStockMovementRepository,
  type IStockUnitOfWork,
  type StockTransactionContext,
} from '@modules/stock/index.js';
import { CreatePurchaseUseCase } from './create-purchase.use-case.js';
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

/**
 * End-to-end integration proving the producer/consumer wiring of task 21.2:
 *
 *   CreatePurchaseUseCase.complete() → PurchaseCompletedEvent buffered
 *   → published on a REAL {@link InMemoryEventBus} (post-commit)
 *   → {@link StockEventHandlers} (actually subscribed)
 *   → {@link RecordStockMovementUseCase} → {@link AdjustStockUseCase}
 *   → an `IN` movement referenced `purchase:<purchaseId>` increments in-memory
 *     stock.
 *
 * No mocks sit between the purchase and the stock write — only in-memory repos
 * stand in for the database, so this exercises the genuine event contract. A
 * purchase carries no branch dimension, so every movement targets the
 * tenant-wide (`branchId: null`) balance, opening it on first movement.
 */

// --- In-memory stock consumer -------------------------------------------------

function stockKey(productId: string, branchId: string | null): string {
  return `${productId}::${branchId ?? '∅'}`;
}

function makeStocks(seed: Stock[] = []): IStockRepository {
  const byKey = new Map<string, Stock>();
  for (const s of seed) {
    byKey.set(stockKey(s.productId, s.branchId), s);
  }
  return {
    findByProductBranch: vi.fn(async (_tenantId: string, productId: string, branchId) =>
      byKey.get(stockKey(productId, branchId)) ?? null,
    ),
    findByTenant: vi.fn(),
    findLowStock: vi.fn(),
    save: vi.fn(async (stock: Stock) => {
      byKey.set(stockKey(stock.productId, stock.branchId), stock);
      return stock;
    }),
  } as unknown as IStockRepository;
}

function makeMovements(): IStockMovementRepository & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    create: vi.fn(async (movement) => {
      created.push(movement);
      return movement;
    }),
    findMany: vi.fn(),
  } as unknown as IStockMovementRepository & { created: unknown[] };
}

function makeStockUow(
  stocks: IStockRepository,
  movements: IStockMovementRepository,
): IStockUnitOfWork {
  return {
    execute<T>(work: (ctx: StockTransactionContext) => Promise<T>): Promise<T> {
      return work({ stocks, movements });
    },
  };
}

function makeLogger(): StockEventLogger & { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn(), error: vi.fn() };
}

// --- In-memory purchase producer ---------------------------------------------

class FakePurchaseRepository implements Partial<IPurchaseRepository> {
  public created: Purchase | null = null;
  nextPurchaseNumber = vi.fn(async (): Promise<string> => 'PUR-000001');
  create = vi.fn(async (purchase: Purchase): Promise<Purchase> => {
    this.created = purchase;
    return purchase;
  });
}

function cost(productId: string, unitCost: string, taxRate: number): ProductCost {
  return { productId, unitCost: Money.fromDecimal(unitCost, 'ARS'), taxRate };
}

describe('CreatePurchase → PurchaseCompleted → Stock increment (integration)', () => {
  let bus: InMemoryEventBus;
  let stocks: IStockRepository;
  let movements: IStockMovementRepository & { created: unknown[] };
  let logger: ReturnType<typeof makeLogger>;
  let purchaseRepo: FakePurchaseRepository;
  let createPurchase: CreatePurchaseUseCase;

  const input: CreatePurchaseInputDto = {
    tenantId: 'tenant-1',
    supplierId: 'sup-1',
    userId: 'user-1',
    items: [
      { productId: 'p1', quantity: 3 },
      { productId: 'p2', quantity: 2 },
    ],
  };

  function wire(seed: Stock[]): void {
    bus = new InMemoryEventBus((error) => {
      throw error instanceof Error ? error : new Error(String(error));
    });
    stocks = makeStocks(seed);
    movements = makeMovements();
    logger = makeLogger();

    const adjust = new AdjustStockUseCase(makeStockUow(stocks, movements));
    const record = new RecordStockMovementUseCase(adjust);
    new StockEventHandlers(record, logger).register(bus);

    purchaseRepo = new FakePurchaseRepository();
    const unitOfWork = {
      execute: (work: (ctx: PurchaseTransactionContext) => Promise<unknown>) =>
        work({ purchases: purchaseRepo as unknown as IPurchaseRepository }),
    } as unknown as IPurchaseUnitOfWork;
    const products = {
      findCost: vi.fn(async (_tenantId: string, productId: string) => {
        if (productId === 'p1') return cost('p1', '100.00', 21);
        if (productId === 'p2') return cost('p2', '50.00', 0);
        return null;
      }),
    } as unknown as IPurchaseProductReader;
    const suppliers = { exists: vi.fn(async () => true) } as unknown as IPurchaseSupplierReader;

    createPurchase = new CreatePurchaseUseCase(unitOfWork, products, suppliers, bus);
  }

  beforeEach(() => {
    // p1 already has 5 on hand tenant-wide; p2 has no balance yet (opened on IN).
    wire([Stock.create({ tenantId: 'tenant-1', productId: 'p1', branchId: null, quantity: 5 })]);
  });

  it('drives an IN movement per line that increments the tenant-wide balance', async () => {
    const output = await createPurchase.execute(input);
    const purchaseId = output.id;

    // p1: 5 + 3 = 8 (existing balance increased);
    // p2: 0 + 2 = 2 (balance opened on first movement). Both branchId: null.
    const p1 = await stocks.findByProductBranch('tenant-1', 'p1', null);
    const p2 = await stocks.findByProductBranch('tenant-1', 'p2', null);
    expect(p1?.quantity).toBe(8);
    expect(p2?.quantity).toBe(2);

    // Two IN movements were recorded, referenced back to the purchase.
    expect(movements.created).toHaveLength(2);
    for (const movement of movements.created as Array<{
      type: string;
      reference: string | null;
      branchId: string | null;
    }>) {
      expect(movement.type).toBe('IN');
      expect(movement.reference).toBe(`purchase:${purchaseId}`);
      expect(movement.branchId).toBeNull();
    }
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not increment stock for a draft purchase (no completion event)', async () => {
    await createPurchase.execute({ ...input, status: 'draft' });

    const p1 = await stocks.findByProductBranch('tenant-1', 'p1', null);
    expect(p1?.quantity).toBe(5);
    const p2 = await stocks.findByProductBranch('tenant-1', 'p2', null);
    expect(p2).toBeNull();
    expect(movements.created).toHaveLength(0);
  });
});
