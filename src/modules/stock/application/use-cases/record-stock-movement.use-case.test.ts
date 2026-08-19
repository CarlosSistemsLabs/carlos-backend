import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordStockMovementUseCase } from './record-stock-movement.use-case.js';
import { AdjustStockUseCase } from './adjust-stock.use-case.js';
import { Stock } from '../../domain/entities/stock.js';
import type { StockMovement } from '../../domain/entities/stock-movement.js';
import { InsufficientStockError } from '../../domain/errors/stock-errors.js';
import type { IStockRepository } from '../../domain/repositories/stock-repository.js';
import type { IStockMovementRepository } from '../../domain/repositories/stock-movement-repository.js';
import type {
  IStockUnitOfWork,
  StockTransactionContext,
} from '../../domain/repositories/stock-unit-of-work.js';
import type { RecordStockMovementInputDto } from '../dto/stock-dtos.js';

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

function makeUow(stocks: IStockRepository, movements: IStockMovementRepository): IStockUnitOfWork {
  return {
    execute<T>(work: (ctx: StockTransactionContext) => Promise<T>): Promise<T> {
      return work({ stocks, movements });
    },
  };
}

const baseInput: RecordStockMovementInputDto = {
  tenantId: 'tenant-1',
  productId: 'prod-1',
  branchId: 'branch-1',
  type: 'IN',
  quantity: 5,
  reference: 'purchase:po-1',
};

describe('RecordStockMovementUseCase', () => {
  let stocks: IStockRepository;
  let movements: IStockMovementRepository;
  let useCase: RecordStockMovementUseCase;

  beforeEach(() => {
    stocks = makeStocks();
    movements = makeMovements();
    useCase = new RecordStockMovementUseCase(new AdjustStockUseCase(makeUow(stocks, movements)));
  });

  it('records an IN movement with its reference and updates the balance', async () => {
    const result = await useCase.execute(baseInput);

    expect(result.stocks[0]?.quantity).toBe(5);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]?.type).toBe('IN');
    expect(result.movements[0]?.reference).toBe('purchase:po-1');
    expect(movements.create).toHaveBeenCalledOnce();
  });

  it('records an OUT movement referenced to a sale and decrements the balance', async () => {
    stocks = makeStocks([
      Stock.create({ tenantId: 'tenant-1', productId: 'prod-1', branchId: 'branch-1', quantity: 8 }),
    ]);
    movements = makeMovements();
    useCase = new RecordStockMovementUseCase(new AdjustStockUseCase(makeUow(stocks, movements)));

    const result = await useCase.execute({
      ...baseInput,
      type: 'OUT',
      quantity: 3,
      reference: 'sale:s-9',
    });

    expect(result.stocks[0]?.quantity).toBe(5);
    expect(result.movements[0]?.type).toBe('OUT');
    expect(result.movements[0]?.reference).toBe('sale:s-9');
  });

  it('composes AdjustStockUseCase (single atomic write path) rather than re-implementing it', async () => {
    const adjust = new AdjustStockUseCase(makeUow(stocks, movements));
    const spy = vi.spyOn(adjust, 'execute');
    useCase = new RecordStockMovementUseCase(adjust);

    await useCase.execute(baseInput);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      type: 'IN',
      quantity: 5,
      reference: 'purchase:po-1',
    });
  });

  it('propagates InsufficientStockError when an OUT exceeds available and records nothing', async () => {
    stocks = makeStocks([
      Stock.create({ tenantId: 'tenant-1', productId: 'prod-1', branchId: 'branch-1', quantity: 2 }),
    ]);
    movements = makeMovements();
    useCase = new RecordStockMovementUseCase(new AdjustStockUseCase(makeUow(stocks, movements)));

    await expect(
      useCase.execute({ ...baseInput, type: 'OUT', quantity: 5, reference: 'sale:s-1' }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(movements.create).not.toHaveBeenCalled();
  });

  it('rejects a missing or blank reference before touching the write path', async () => {
    const adjust = new AdjustStockUseCase(makeUow(stocks, movements));
    const spy = vi.spyOn(adjust, 'execute');
    useCase = new RecordStockMovementUseCase(adjust);

    await expect(
      useCase.execute({ ...baseInput, reference: '   ' }),
    ).rejects.toThrow(/reference is required/);
    expect(spy).not.toHaveBeenCalled();
    expect(stocks.save).not.toHaveBeenCalled();
  });
});
