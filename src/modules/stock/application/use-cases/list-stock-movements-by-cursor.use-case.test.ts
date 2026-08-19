import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListStockMovementsByCursorUseCase } from './list-stock-movements-by-cursor.use-case.js';
import { StockMovement } from '../../domain/entities/stock-movement.js';
import { buildCursorPage, type CursorPage } from '@shared/pagination/cursor.js';
import type {
  IStockMovementCursorReader,
  StockMovementCursorQuery,
} from '../../domain/repositories/stock-movement-cursor-reader.js';

function movement(
  overrides: Partial<Parameters<typeof StockMovement.create>[0]> = {},
): StockMovement {
  return StockMovement.create({
    tenantId: 'tenant-1',
    productId: 'prod-1',
    branchId: 'branch-1',
    type: 'OUT',
    quantity: 2,
    reference: 'sale:s-1',
    ...overrides,
  });
}

function makeReader(items: StockMovement[]): {
  reader: IStockMovementCursorReader;
  findManyByCursor: ReturnType<typeof vi.fn>;
} {
  const findManyByCursor = vi.fn(
    async (
      _tenantId: string,
      query: StockMovementCursorQuery,
    ): Promise<CursorPage<StockMovement>> =>
      // Emulate the repository's over-fetch contract: it is handed limit+1 rows.
      buildCursorPage(items, query.limit, (m) => m.id),
  );
  return { reader: { findManyByCursor }, findManyByCursor };
}

describe('ListStockMovementsByCursorUseCase', () => {
  let items: StockMovement[];
  let reader: IStockMovementCursorReader;
  let findManyByCursor: ReturnType<typeof vi.fn>;
  let useCase: ListStockMovementsByCursorUseCase;

  beforeEach(() => {
    items = [movement(), movement({ type: 'IN', reference: 'purchase:po-1' })];
    ({ reader, findManyByCursor } = makeReader(items));
    useCase = new ListStockMovementsByCursorUseCase(reader);
  });

  it('returns projected movements with cursor metadata', async () => {
    const result = await useCase.execute({ tenantId: 'tenant-1' });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.reference).toBe('sale:s-1');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('clamps the limit to the platform maximum before querying', async () => {
    await useCase.execute({ tenantId: 'tenant-1', limit: 5000 });

    const query = findManyByCursor.mock.calls[0]?.[1] as StockMovementCursorQuery;
    expect(query.limit).toBe(100);
  });

  it('defaults the limit when omitted', async () => {
    await useCase.execute({ tenantId: 'tenant-1' });

    const query = findManyByCursor.mock.calls[0]?.[1] as StockMovementCursorQuery;
    expect(query.limit).toBe(20);
  });

  it('forwards the cursor and all filters to the reader', async () => {
    const from = new Date('2024-01-01T00:00:00.000Z');
    const to = new Date('2024-01-31T23:59:59.000Z');

    await useCase.execute({
      tenantId: 'tenant-1',
      cursor: 'opaque-cursor',
      productId: 'prod-9',
      branchId: 'branch-2',
      type: 'OUT',
      from,
      to,
    });

    const query = findManyByCursor.mock.calls[0]?.[1] as StockMovementCursorQuery;
    expect(query.cursor).toBe('opaque-cursor');
    expect(query.filters).toEqual({
      productId: 'prod-9',
      branchId: 'branch-2',
      type: 'OUT',
      from,
      to,
    });
  });

  it('supports a tenant-wide (null branch) filter', async () => {
    await useCase.execute({ tenantId: 'tenant-1', branchId: null });

    const query = findManyByCursor.mock.calls[0]?.[1] as StockMovementCursorQuery;
    expect(query.filters?.branchId).toBeNull();
  });

  it('rejects an unknown movement type before querying', async () => {
    await expect(useCase.execute({ tenantId: 'tenant-1', type: 'BOGUS' })).rejects.toThrow();
    expect(findManyByCursor).not.toHaveBeenCalled();
  });

  it('exposes a next cursor when the reader reports more rows', async () => {
    // Three rows with a limit of 2 -> a further page exists.
    const three = [movement(), movement(), movement()];
    ({ reader, findManyByCursor } = makeReader(three));
    useCase = new ListStockMovementsByCursorUseCase(reader);

    const result = await useCase.execute({ tenantId: 'tenant-1', limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });
});
