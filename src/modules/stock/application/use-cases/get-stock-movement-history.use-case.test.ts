import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetStockMovementHistoryUseCase } from './get-stock-movement-history.use-case.js';
import { StockMovement } from '../../domain/entities/stock-movement.js';
import type { PaginatedResult } from '@shared/types/index.js';
import type {
  IStockMovementRepository,
  StockMovementQuery,
} from '../../domain/repositories/stock-movement-repository.js';

function movement(overrides: Partial<Parameters<typeof StockMovement.create>[0]> = {}): StockMovement {
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

function makeRepo(items: StockMovement[]): {
  repo: IStockMovementRepository;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(
    async (_tenantId: string, query: StockMovementQuery): Promise<PaginatedResult<StockMovement>> => ({
      items,
      total: items.length,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: items.length === 0 ? 0 : Math.ceil(items.length / query.pageSize),
    }),
  );
  return { repo: { create: vi.fn(), findMany }, findMany };
}

describe('GetStockMovementHistoryUseCase', () => {
  let items: StockMovement[];
  let repo: IStockMovementRepository;
  let findMany: ReturnType<typeof vi.fn>;
  let useCase: GetStockMovementHistoryUseCase;

  beforeEach(() => {
    items = [movement(), movement({ type: 'IN', reference: 'purchase:po-1' })];
    ({ repo, findMany } = makeRepo(items));
    useCase = new GetStockMovementHistoryUseCase(repo);
  });

  it('returns projected movements with pagination metadata', async () => {
    const result = await useCase.execute({ tenantId: 'tenant-1' });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.reference).toBe('sale:s-1');
    expect(result.meta).toMatchObject({ total: 2, page: 1, pageSize: 20, totalPages: 1 });
  });

  it('clamps pagination to platform bounds before querying the repository', async () => {
    await useCase.execute({ tenantId: 'tenant-1', page: 0, pageSize: 5000 });

    const query = findMany.mock.calls[0]?.[1] as StockMovementQuery;
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(100);
  });

  it('forwards product, branch, type and date-range filters to the repository', async () => {
    const from = new Date('2024-01-01T00:00:00.000Z');
    const to = new Date('2024-01-31T23:59:59.000Z');

    await useCase.execute({
      tenantId: 'tenant-1',
      productId: 'prod-9',
      branchId: 'branch-2',
      type: 'OUT',
      from,
      to,
    });

    const query = findMany.mock.calls[0]?.[1] as StockMovementQuery;
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

    const query = findMany.mock.calls[0]?.[1] as StockMovementQuery;
    expect(query.filters?.branchId).toBeNull();
  });

  it('rejects an unknown movement type before querying', async () => {
    await expect(
      useCase.execute({ tenantId: 'tenant-1', type: 'BOGUS' }),
    ).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
});
