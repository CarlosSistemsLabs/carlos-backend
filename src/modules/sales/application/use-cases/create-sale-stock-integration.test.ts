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
import { CreateSaleUseCase } from './create-sale.use-case.js';
import type { Sale } from '../../domain/entities/sale.js';
import type { ISaleRepository } from '../../domain/repositories/sale-repository.js';
import type {
  ISaleUnitOfWork,
  SaleTransactionContext,
} from '../../domain/repositories/sale-unit-of-work.js';
import type { ISaleProductReader, ProductPricing } from '../../domain/ports/sale-product-reader.js';
import type { ISaleCustomerReader } from '../../domain/ports/sale-customer-reader.js';
import type { CreateSaleInputDto } from '../dto/sale-dtos.js';

/**
 * End-to-end integration proving the producer/consumer wiring of task 19.2:
 *
 *   CreateSaleUseCase.complete() → SaleCompletedEvent buffered
 *   → published on a REAL {@link InMemoryEventBus} (post-commit)
 *   → {@link StockEventHandlers} (actually subscribed)
 *   → {@link RecordStockMovementUseCase} → {@link AdjustStockUseCase}
 *   → an `OUT` movement referenced `sale:<saleId>` decrements in-memory stock.
 *
 * No mocks sit between the sale and the stock write — only in-memory repos stand
 * in for the database, so this exercises the genuine event contract and the
 * documented log-and-continue behaviour for insufficient stock.
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

// --- In-memory sale producer --------------------------------------------------

class FakeSaleRepository implements Partial<ISaleRepository> {
  public created: Sale | null = null;
  nextSaleNumber = vi.fn(async (): Promise<string> => 'SALE-000001');
  create = vi.fn(async (sale: Sale): Promise<Sale> => {
    this.created = sale;
    return sale;
  });
}

function pricing(productId: string, unitPrice: string, taxRate: number): ProductPricing {
  return { productId, unitPrice: Money.fromDecimal(unitPrice, 'ARS'), taxRate };
}

describe('CreateSale → SaleCompleted → Stock decrement (integration)', () => {
  let bus: InMemoryEventBus;
  let stocks: IStockRepository;
  let movements: IStockMovementRepository & { created: unknown[] };
  let logger: ReturnType<typeof makeLogger>;
  let saleRepo: FakeSaleRepository;
  let createSale: CreateSaleUseCase;

  const input: CreateSaleInputDto = {
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    userId: 'user-1',
    branchId: 'branch-1',
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

    saleRepo = new FakeSaleRepository();
    const unitOfWork = {
      execute: (work: (ctx: SaleTransactionContext) => Promise<unknown>) =>
        work({ sales: saleRepo as unknown as ISaleRepository }),
    } as unknown as ISaleUnitOfWork;
    const products = {
      findPricing: vi.fn(async (_tenantId: string, productId: string) => {
        if (productId === 'p1') return pricing('p1', '100.00', 21);
        if (productId === 'p2') return pricing('p2', '50.00', 0);
        return null;
      }),
    } as unknown as ISaleProductReader;
    const customers = { exists: vi.fn(async () => true) } as unknown as ISaleCustomerReader;

    createSale = new CreateSaleUseCase(unitOfWork, products, customers, bus);
  }

  beforeEach(() => {
    wire([
      Stock.create({ tenantId: 'tenant-1', productId: 'p1', branchId: 'branch-1', quantity: 10 }),
      Stock.create({ tenantId: 'tenant-1', productId: 'p2', branchId: 'branch-1', quantity: 10 }),
    ]);
  });

  it('drives an OUT movement per line that decrements branch stock', async () => {
    const output = await createSale.execute(input);
    const saleId = output.id;

    // p1: 10 - 3 = 7, p2: 10 - 2 = 8, both on branch-1.
    const p1 = await stocks.findByProductBranch('tenant-1', 'p1', 'branch-1');
    const p2 = await stocks.findByProductBranch('tenant-1', 'p2', 'branch-1');
    expect(p1?.quantity).toBe(7);
    expect(p2?.quantity).toBe(8);

    // Two OUT movements were recorded, referenced back to the sale.
    expect(movements.created).toHaveLength(2);
    for (const movement of movements.created as Array<{ type: string; reference: string | null }>) {
      expect(movement.type).toBe('OUT');
      expect(movement.reference).toBe(`sale:${saleId}`);
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs-and-continues on insufficient stock without failing the completed sale', async () => {
    // p1 only has 1 unit on hand but the sale needs 3; p2 has plenty.
    wire([
      Stock.create({ tenantId: 'tenant-1', productId: 'p1', branchId: 'branch-1', quantity: 1 }),
      Stock.create({ tenantId: 'tenant-1', productId: 'p2', branchId: 'branch-1', quantity: 10 }),
    ]);

    // The sale still completes successfully (no throw from the bus).
    const output = await createSale.execute(input);
    expect(output.status).toBe('completed');

    // p1 shortfall is logged for reconciliation and its balance is untouched.
    expect(logger.warn).toHaveBeenCalledOnce();
    const p1 = await stocks.findByProductBranch('tenant-1', 'p1', 'branch-1');
    expect(p1?.quantity).toBe(1);

    // p2 is still decremented — one bad line never blocks the rest.
    const p2 = await stocks.findByProductBranch('tenant-1', 'p2', 'branch-1');
    expect(p2?.quantity).toBe(8);
  });

  it('does not decrement stock for a draft sale (no completion event)', async () => {
    await createSale.execute({ ...input, status: 'draft' });

    const p1 = await stocks.findByProductBranch('tenant-1', 'p1', 'branch-1');
    expect(p1?.quantity).toBe(10);
    expect(movements.created).toHaveLength(0);
  });
});
