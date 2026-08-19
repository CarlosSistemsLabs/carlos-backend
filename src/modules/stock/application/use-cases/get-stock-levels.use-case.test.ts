import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetStockLevelsUseCase } from './get-stock-levels.use-case.js';
import { Stock } from '../../domain/entities/stock.js';
import type {
  IStockRepository,
  StockLevelView,
} from '../../domain/repositories/stock-repository.js';
import type { PaginatedResult } from '@shared/types/index.js';

function view(quantity: number, minStock: number, productId = 'prod-1'): StockLevelView {
  return {
    stock: Stock.create({ tenantId: 'tenant-1', productId, branchId: 'branch-1', quantity }),
    productName: `Product ${productId}`,
    minStock,
  };
}

function page(items: StockLevelView[]): PaginatedResult<StockLevelView> {
  return { items, total: items.length, page: 1, pageSize: 20, totalPages: 1 };
}

function makeStocks(): IStockRepository {
  return {
    findByProductBranch: vi.fn(),
    findByTenant: vi.fn(),
    findLowStock: vi.fn(),
    save: vi.fn(),
  };
}

describe('GetStockLevelsUseCase', () => {
  let stocks: IStockRepository;
  let useCase: GetStockLevelsUseCase;

  beforeEach(() => {
    stocks = makeStocks();
    useCase = new GetStockLevelsUseCase(stocks);
  });

  it('lists all levels and computes the lowStock flag per row', async () => {
    vi.mocked(stocks.findByTenant).mockResolvedValue(
      page([view(2, 5, 'a'), view(9, 5, 'b'), view(5, 5, 'c')]),
    );

    const result = await useCase.execute({ tenantId: 'tenant-1' });

    expect(stocks.findByTenant).toHaveBeenCalledOnce();
    expect(stocks.findLowStock).not.toHaveBeenCalled();
    expect(result.items.map((i) => i.lowStock)).toEqual([true, false, true]);
    expect(result.items[0]).toMatchObject({ quantity: 2, minStock: 5, productName: 'Product a' });
    expect(result.meta).toMatchObject({ total: 3, page: 1, pageSize: 20, totalPages: 1 });
  });

  it('routes to findLowStock when lowStockOnly is requested', async () => {
    vi.mocked(stocks.findLowStock).mockResolvedValue(page([view(1, 5, 'a')]));

    const result = await useCase.execute({ tenantId: 'tenant-1', lowStockOnly: true });

    expect(stocks.findLowStock).toHaveBeenCalledOnce();
    expect(stocks.findByTenant).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.lowStock).toBe(true);
  });

  it('clamps pagination and forwards product/branch filters', async () => {
    vi.mocked(stocks.findByTenant).mockResolvedValue(page([]));

    await useCase.execute({
      tenantId: 'tenant-1',
      page: 0,
      pageSize: 1000,
      productId: 'prod-9',
      branchId: null,
    });

    expect(stocks.findByTenant).toHaveBeenCalledWith('tenant-1', {
      page: 1,
      pageSize: 100,
      filters: { productId: 'prod-9', branchId: null },
    });
  });
});
