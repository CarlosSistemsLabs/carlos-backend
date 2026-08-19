import { describe, it, expect, vi } from 'vitest';
import { StockReportUseCase } from './stock-report.use-case.js';
import type {
  IStockReportReader,
  StockLevelItem,
  StockReportData,
  StockReportFilters,
} from '../../domain/ports/stock-report-reader.js';

function item(overrides: Partial<StockLevelItem>): StockLevelItem {
  return {
    productId: 'p1',
    productName: 'Widget',
    sku: 'SKU-1',
    branchId: null,
    quantity: 5,
    minStock: 10,
    isLowStock: true,
    ...overrides,
  };
}

function makeReader(data: StockReportData): {
  reader: IStockReportReader;
  stockLevels: ReturnType<typeof vi.fn>;
} {
  const stockLevels = vi.fn(
    async (_tenantId: string, _filters: StockReportFilters): Promise<StockReportData> => data,
  );
  return { reader: { stockLevels }, stockLevels };
}

describe('StockReportUseCase', () => {
  it('maps items, low-stock subset and counts to output', async () => {
    const low = item({ productId: 'p1', quantity: 2, minStock: 10, isLowStock: true });
    const ok = item({ productId: 'p2', quantity: 50, minStock: 10, isLowStock: false });
    const { reader } = makeReader({
      items: [low, ok],
      lowStock: [low],
      totalItems: 2,
      lowStockCount: 1,
    });

    const result = await new StockReportUseCase(reader).execute({ tenantId: 't1' });

    expect(result.totalItems).toBe(2);
    expect(result.lowStockCount).toBe(1);
    expect(result.items).toHaveLength(2);
    expect(result.lowStock).toEqual([
      {
        productId: 'p1',
        productName: 'Widget',
        sku: 'SKU-1',
        branchId: null,
        quantity: 2,
        minStock: 10,
        isLowStock: true,
      },
    ]);
  });

  it('returns empty structures when there is no stock', async () => {
    const { reader } = makeReader({ items: [], lowStock: [], totalItems: 0, lowStockCount: 0 });

    const result = await new StockReportUseCase(reader).execute({ tenantId: 't1' });

    expect(result).toEqual({ items: [], lowStock: [], totalItems: 0, lowStockCount: 0 });
  });

  it('forwards the branch filter when provided and omits it otherwise', async () => {
    const { reader, stockLevels } = makeReader({
      items: [],
      lowStock: [],
      totalItems: 0,
      lowStockCount: 0,
    });

    await new StockReportUseCase(reader).execute({ tenantId: 't1', branchId: 'b1' });
    expect(stockLevels.mock.calls[0]![1]).toEqual({ branchId: 'b1' });

    await new StockReportUseCase(reader).execute({ tenantId: 't1' });
    expect(stockLevels.mock.calls[1]![1]).toEqual({});
  });
});
