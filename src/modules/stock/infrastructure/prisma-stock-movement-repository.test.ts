import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaStockMovementRepository,
  type StockMovementPrismaClient,
  type StockMovementRow,
  type StockMovementFindArgs,
} from './prisma-stock-movement-repository.js';
import { decodeCursor } from '@shared/pagination/cursor.js';

function movementRow(overrides: Partial<StockMovementRow> = {}): StockMovementRow {
  return {
    id: 'mov-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    branchId: 'branch-1',
    type: 'OUT',
    quantity: 3,
    reference: 'sale:s-1',
    notes: null,
    createdAt: new Date('2024-01-10T10:00:00.000Z'),
    ...overrides,
  };
}

function makeClient(): StockMovementPrismaClient {
  return {
    stockMovement: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async () => movementRow()),
    },
  };
}

describe('PrismaStockMovementRepository', () => {
  let client: StockMovementPrismaClient;
  let repo: PrismaStockMovementRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaStockMovementRepository(client);
  });

  describe('findMany (offset)', () => {
    it('applies tenant scope, filters, ordering and offset pagination', async () => {
      vi.mocked(client.stockMovement.findMany).mockResolvedValue([movementRow()]);
      vi.mocked(client.stockMovement.count).mockResolvedValue(1);

      const result = await repo.findMany('tenant-1', {
        page: 2,
        pageSize: 10,
        filters: { productId: 'prod-1', type: 'OUT' },
      });

      const args = vi.mocked(client.stockMovement.findMany).mock.calls[0]![0];
      expect(args.where).toEqual({ tenantId: 'tenant-1', productId: 'prod-1', type: 'OUT' });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10, totalPages: 1 });
    });
  });

  describe('findManyByCursor (keyset)', () => {
    it('over-fetches limit+1, orders by createdAt+id and selects only mapped columns (first page)', async () => {
      vi.mocked(client.stockMovement.findMany).mockResolvedValue([movementRow()]);

      await repo.findManyByCursor('tenant-1', { limit: 20, filters: { productId: 'prod-1' } });

      const args = vi.mocked(client.stockMovement.findMany).mock.calls[0]![0] as StockMovementFindArgs;
      // Tenant scope is always applied (defence-in-depth, Req 1.5).
      expect(args.where).toEqual({ tenantId: 'tenant-1', productId: 'prod-1' });
      // Stable ordering with an id tie-breaker.
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      // Look-ahead: fetch one more than the page size.
      expect(args.take).toBe(21);
      // No cursor on the first page.
      expect(args.cursor).toBeUndefined();
      expect(args.skip).toBeUndefined();
      // Only the mapped columns are projected (no over-fetch).
      expect(args.select).toMatchObject({ id: true, tenantId: true, createdAt: true, quantity: true });
    });

    it('seeks past the previous page using cursor id + skip:1 when a cursor is supplied', async () => {
      vi.mocked(client.stockMovement.findMany).mockResolvedValue([]);
      const cursor = Buffer.from(JSON.stringify({ id: 'mov-99' }), 'utf8').toString('base64url');

      await repo.findManyByCursor('tenant-1', { limit: 5, cursor });

      const args = vi.mocked(client.stockMovement.findMany).mock.calls[0]![0] as StockMovementFindArgs;
      expect(args.cursor).toEqual({ id: 'mov-99' });
      expect(args.skip).toBe(1);
      expect(args.take).toBe(6);
    });

    it('ignores a malformed cursor and falls back to the first page', async () => {
      vi.mocked(client.stockMovement.findMany).mockResolvedValue([]);

      await repo.findManyByCursor('tenant-1', { limit: 5, cursor: 'not-a-cursor!!!' });

      const args = vi.mocked(client.stockMovement.findMany).mock.calls[0]![0] as StockMovementFindArgs;
      expect(args.cursor).toBeUndefined();
      expect(args.skip).toBeUndefined();
    });

    it('reports hasMore and derives the next cursor from the last KEPT row', async () => {
      // limit 2, three rows returned -> a further page exists.
      vi.mocked(client.stockMovement.findMany).mockResolvedValue([
        movementRow({ id: 'mov-a' }),
        movementRow({ id: 'mov-b' }),
        movementRow({ id: 'mov-c' }),
      ]);

      const page = await repo.findManyByCursor('tenant-1', { limit: 2 });

      expect(page.items.map((m) => m.id)).toEqual(['mov-a', 'mov-b']);
      expect(page.hasMore).toBe(true);
      expect(decodeCursor(page.nextCursor)).toEqual({ id: 'mov-b' });
    });

    it('marks the last page with a null next cursor', async () => {
      vi.mocked(client.stockMovement.findMany).mockResolvedValue([movementRow({ id: 'mov-a' })]);

      const page = await repo.findManyByCursor('tenant-1', { limit: 2 });

      expect(page.items.map((m) => m.id)).toEqual(['mov-a']);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });
});
