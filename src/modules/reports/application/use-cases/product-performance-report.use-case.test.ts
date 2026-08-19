import { describe, it, expect, vi } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { ProductPerformanceReportUseCase } from './product-performance-report.use-case.js';
import type {
  IProductPerformanceReader,
  ProductPerformanceData,
  ProductPerformanceFilters,
} from '../../domain/ports/product-performance-reader.js';
import { InvalidDateRangeError } from '../../domain/errors/report-errors.js';

const CURRENCY = 'ARS';

function makeReader(data: ProductPerformanceData): {
  reader: IProductPerformanceReader;
  productPerformance: ReturnType<typeof vi.fn>;
} {
  const productPerformance = vi.fn(
    async (
      _tenantId: string,
      _filters: ProductPerformanceFilters,
    ): Promise<ProductPerformanceData> => data,
  );
  return { reader: { productPerformance }, productPerformance };
}

describe('ProductPerformanceReportUseCase', () => {
  it('maps ranked products to decimal-string revenue output', async () => {
    const { reader } = makeReader({
      products: [
        {
          productId: 'p1',
          productName: 'Widget',
          sku: 'SKU-1',
          quantitySold: 42,
          revenue: Money.fromDecimal('1234.50', CURRENCY),
        },
      ],
    });

    const result = await new ProductPerformanceReportUseCase(reader).execute({ tenantId: 't1' });

    expect(result.products).toEqual([
      {
        productId: 'p1',
        productName: 'Widget',
        sku: 'SKU-1',
        quantitySold: 42,
        revenue: '1234.50',
      },
    ]);
  });

  it('defaults and clamps the top-N limit', async () => {
    const { reader, productPerformance } = makeReader({ products: [] });

    await new ProductPerformanceReportUseCase(reader).execute({ tenantId: 't1' });
    expect(productPerformance.mock.calls[0]![1]).toMatchObject({ limit: 10 });

    await new ProductPerformanceReportUseCase(reader).execute({ tenantId: 't1', limit: 5000 });
    expect(productPerformance.mock.calls[1]![1]).toMatchObject({ limit: 100 });
  });

  it('returns an empty ranking when there are no sales', async () => {
    const { reader } = makeReader({ products: [] });

    const result = await new ProductPerformanceReportUseCase(reader).execute({ tenantId: 't1' });

    expect(result.products).toEqual([]);
  });

  it('rejects an inverted date range', async () => {
    const { reader, productPerformance } = makeReader({ products: [] });

    await expect(
      new ProductPerformanceReportUseCase(reader).execute({
        tenantId: 't1',
        from: new Date('2024-06-01T00:00:00.000Z'),
        to: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
    expect(productPerformance).not.toHaveBeenCalled();
  });
});
