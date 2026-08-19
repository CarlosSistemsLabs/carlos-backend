import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdjustStockUseCase } from './adjust-stock.use-case.js';
import { Stock } from '../../domain/entities/stock.js';
import type { StockMovement } from '../../domain/entities/stock-movement.js';
import { InsufficientStockError } from '../../domain/errors/stock-errors.js';
import { InvalidStockTransferError } from '../../domain/errors/stock-errors.js';
import type { IStockRepository } from '../../domain/repositories/stock-repository.js';
import type { IStockMovementRepository } from '../../domain/repositories/stock-movement-repository.js';
import type {
  IStockUnitOfWork,
  StockTransactionContext,
} from '../../domain/repositories/stock-unit-of-work.js';
import type { AdjustStockInputDto } from '../dto/stock-dtos.js';

/**
 * In-memory stock repository keyed by `productId::branchId`, so a load-or-open
 * flow behaves like a real store within a single test.
 */
function makeStocks(seed: Stock[] = []): IStockRepository {
  const byKey = new Map<string, Stock>();
  const key = (productId: string, branchId: string | null): string =>
    `${productId}::${branchId ?? '∅'}`;
  for (const s of seed) {
    byKey.set(key(s.productId, s.branchId), s);
  }
  return {
    findByProductBranch: vi.fn(async (_tenantId: string, productId: string, branchId) =>
      byKey.get(key(productId, branchId)) ?? null,
    ),
    findByTenant: vi.fn(),
    findLowStock: vi.fn(),
    save: vi.fn(async (stock: Stock) => {
      byKey.set(key(stock.productId, stock.branchId), stock);
      return stock;
    }),
  };
}

function makeMovements(): IStockMovementRepository {
  return {
    create: vi.fn(async (movement: StockMovement) => movement),
    findMany: vi.fn(),
  };
}

/** A unit of work that runs the callback against injected in-memory repos. */
function makeUow(stocks: IStockRepository, movements: IStockMovementRepository): IStockUnitOfWork {
  return {
    execute<T>(work: (ctx: StockTransactionContext) => Promise<T>): Promise<T> {
      return work({ stocks, movements });
    },
  };
}

const baseInput: AdjustStockInputDto = {
  tenantId: 'tenant-1',
  productId: 'prod-1',
  branchId: 'branch-1',
  type: 'IN',
  quantity: 10,
};

describe('AdjustStockUseCase', () => {
  let stocks: IStockRepository;
  let movements: IStockMovementRepository;
  let useCase: AdjustStockUseCase;

  beforeEach(() => {
    stocks = makeStocks();
    movements = makeMovements();
    useCase = new AdjustStockUseCase(makeUow(stocks, movements));
  });

  it('opens a balance on the first IN movement and records the movement', async () => {
    const result = await useCase.execute(baseInput);

    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0]?.quantity).toBe(10);
    expect(result.stocks[0]?.branchId).toBe('branch-1');
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]?.type).toBe('IN');
    expect(result.movements[0]?.quantity).toBe(10);
    expect(stocks.save).toHaveBeenCalledOnce();
    expect(movements.create).toHaveBeenCalledOnce();
  });

  it('increases an existing balance on ADJUSTMENT', async () => {
    stocks = makeStocks([
      Stock.create({ tenantId: 'tenant-1', productId: 'prod-1', branchId: 'branch-1', quantity: 4 }),
    ]);
    useCase = new AdjustStockUseCase(makeUow(stocks, movements));

    const result = await useCase.execute({ ...baseInput, type: 'ADJUSTMENT', quantity: 6 });
    expect(result.stocks[0]?.quantity).toBe(10);
  });

  it('decreases the balance on OUT and records a reference', async () => {
    stocks = makeStocks([
      Stock.create({ tenantId: 'tenant-1', productId: 'prod-1', branchId: 'branch-1', quantity: 8 }),
    ]);
    useCase = new AdjustStockUseCase(makeUow(stocks, movements));

    const result = await useCase.execute({
      ...baseInput,
      type: 'OUT',
      quantity: 3,
      reference: 'sale-9',
    });
    expect(result.stocks[0]?.quantity).toBe(5);
    expect(result.movements[0]?.type).toBe('OUT');
    expect(result.movements[0]?.reference).toBe('sale-9');
  });

  it('throws InsufficientStockError when OUT exceeds available and records nothing', async () => {
    stocks = makeStocks([
      Stock.create({ tenantId: 'tenant-1', productId: 'prod-1', branchId: 'branch-1', quantity: 2 }),
    ]);
    movements = makeMovements();
    useCase = new AdjustStockUseCase(makeUow(stocks, movements));

    await expect(useCase.execute({ ...baseInput, type: 'OUT', quantity: 5 })).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
    expect(movements.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid movement type', async () => {
    await expect(useCase.execute({ ...baseInput, type: 'SALE' })).rejects.toThrow();
    expect(stocks.save).not.toHaveBeenCalled();
  });

  describe('TRANSFER', () => {
    it('moves units between branches, recording two movements', async () => {
      stocks = makeStocks([
        Stock.create({
          tenantId: 'tenant-1',
          productId: 'prod-1',
          branchId: 'branch-1',
          quantity: 10,
        }),
      ]);
      movements = makeMovements();
      useCase = new AdjustStockUseCase(makeUow(stocks, movements));

      const result = await useCase.execute({
        tenantId: 'tenant-1',
        productId: 'prod-1',
        branchId: 'branch-1',
        destinationBranchId: 'branch-2',
        type: 'TRANSFER',
        quantity: 4,
      });

      expect(result.stocks).toHaveLength(2);
      const source = result.stocks.find((s) => s.branchId === 'branch-1');
      const dest = result.stocks.find((s) => s.branchId === 'branch-2');
      expect(source?.quantity).toBe(6);
      expect(dest?.quantity).toBe(4);
      expect(result.movements).toHaveLength(2);
      expect(result.movements.every((m) => m.type === 'TRANSFER')).toBe(true);
    });

    it('rejects a transfer without a distinct destination', async () => {
      await expect(
        useCase.execute({ ...baseInput, type: 'TRANSFER', destinationBranchId: 'branch-1' }),
      ).rejects.toBeInstanceOf(InvalidStockTransferError);
      await expect(
        useCase.execute({ ...baseInput, type: 'TRANSFER' }),
      ).rejects.toBeInstanceOf(InvalidStockTransferError);
    });

    it('fails atomically when the source has insufficient stock', async () => {
      stocks = makeStocks([
        Stock.create({
          tenantId: 'tenant-1',
          productId: 'prod-1',
          branchId: 'branch-1',
          quantity: 1,
        }),
      ]);
      movements = makeMovements();
      useCase = new AdjustStockUseCase(makeUow(stocks, movements));

      await expect(
        useCase.execute({
          ...baseInput,
          type: 'TRANSFER',
          destinationBranchId: 'branch-2',
          quantity: 5,
        }),
      ).rejects.toBeInstanceOf(InsufficientStockError);
      expect(movements.create).not.toHaveBeenCalled();
    });
  });
});
