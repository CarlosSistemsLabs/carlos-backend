import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaRepository } from './prisma-repository.js';
import type { PrismaModelDelegate, PrismaRepositoryConfig } from './prisma-repository.js';

interface WidgetRow {
  id: string;
  tenantId: string;
  name: string;
  deletedAt: Date | null;
}

class Widget {
  constructor(
    public readonly id: string,
    public readonly tenantId: string,
    public readonly name: string,
  ) {}
}

class WidgetRepository extends PrismaRepository<Widget, WidgetRow> {
  constructor(model: PrismaModelDelegate<WidgetRow>, config: PrismaRepositoryConfig = {}) {
    super(model, { defaultSortField: 'name', ...config });
  }

  protected toDomain(row: WidgetRow): Widget {
    return new Widget(row.id, row.tenantId, row.name);
  }

  protected toPersistence(entity: Widget): Record<string, unknown> {
    return { id: entity.id, tenantId: entity.tenantId, name: entity.name };
  }
}

function createMockDelegate(): PrismaModelDelegate<WidgetRow> {
  return {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const row = (overrides: Partial<WidgetRow> = {}): WidgetRow => ({
  id: 'w1',
  tenantId: 't1',
  name: 'Widget',
  deletedAt: null,
  ...overrides,
});

describe('PrismaRepository', () => {
  let delegate: PrismaModelDelegate<WidgetRow>;
  let repository: WidgetRepository;

  beforeEach(() => {
    delegate = createMockDelegate();
    repository = new WidgetRepository(delegate);
  });

  describe('findById', () => {
    it('maps the row to a domain entity and excludes soft-deleted rows by default', async () => {
      vi.mocked(delegate.findFirst).mockResolvedValue(row());

      const result = await repository.findById('w1');

      expect(result).toBeInstanceOf(Widget);
      expect(result?.id).toBe('w1');
      expect(delegate.findFirst).toHaveBeenCalledWith({
        where: { id: 'w1', deletedAt: null },
      });
    });

    it('returns null when no row is found', async () => {
      vi.mocked(delegate.findFirst).mockResolvedValue(null);
      expect(await repository.findById('missing')).toBeNull();
    });

    it('includes soft-deleted rows when requested', async () => {
      vi.mocked(delegate.findFirst).mockResolvedValue(row({ deletedAt: new Date() }));

      await repository.findById('w1', { includeDeleted: true });

      expect(delegate.findFirst).toHaveBeenCalledWith({ where: { id: 'w1' } });
    });
  });

  describe('findMany', () => {
    it('returns a paginated result with correct metadata', async () => {
      vi.mocked(delegate.findMany).mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })]);
      vi.mocked(delegate.count).mockResolvedValue(5);

      const result = await repository.findMany({ page: 2, pageSize: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toBeInstanceOf(Widget);
      expect(result).toMatchObject({ total: 5, page: 2, pageSize: 2, totalPages: 3 });
      expect(delegate.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        skip: 2,
        take: 2,
        orderBy: { name: 'asc' },
      });
    });

    it('applies defaults and the provided sort/filter', async () => {
      vi.mocked(delegate.findMany).mockResolvedValue([]);
      vi.mocked(delegate.count).mockResolvedValue(0);

      const result = await repository.findMany({
        filter: { tenantId: 't1' },
        sort: { field: 'name', direction: 'desc' },
      });

      expect(result).toMatchObject({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
      expect(delegate.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', deletedAt: null },
        skip: 0,
        take: 20,
        orderBy: { name: 'desc' },
      });
    });

    it('clamps an oversized page size to the maximum', async () => {
      vi.mocked(delegate.findMany).mockResolvedValue([]);
      vi.mocked(delegate.count).mockResolvedValue(0);

      const result = await repository.findMany({ pageSize: 10_000 });

      expect(result.pageSize).toBe(100);
    });

    it('normalises invalid page numbers to the first page', async () => {
      vi.mocked(delegate.findMany).mockResolvedValue([]);
      vi.mocked(delegate.count).mockResolvedValue(0);

      const result = await repository.findMany({ page: -3 });

      expect(result.page).toBe(1);
    });
  });

  describe('create', () => {
    it('persists the mapped entity and returns the domain representation', async () => {
      const created = row({ id: 'new' });
      vi.mocked(delegate.create).mockResolvedValue(created);

      const result = await repository.create(new Widget('new', 't1', 'Widget'));

      expect(delegate.create).toHaveBeenCalledWith({
        data: { id: 'new', tenantId: 't1', name: 'Widget' },
      });
      expect(result.id).toBe('new');
    });
  });

  describe('update', () => {
    it('updates by id and returns the mapped entity', async () => {
      vi.mocked(delegate.update).mockResolvedValue(row({ name: 'Renamed' }));

      const result = await repository.update('w1', { name: 'Renamed' });

      expect(delegate.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { name: 'Renamed' },
      });
      expect(result.name).toBe('Renamed');
    });
  });

  describe('softDelete', () => {
    it('stamps the deletedAt column when soft-delete is enabled', async () => {
      vi.mocked(delegate.update).mockResolvedValue(row({ deletedAt: new Date() }));

      await repository.softDelete('w1');

      const call = vi.mocked(delegate.update).mock.calls[0]?.[0];
      expect(call?.where).toEqual({ id: 'w1' });
      expect(call?.data.deletedAt).toBeInstanceOf(Date);
      expect(delegate.delete).not.toHaveBeenCalled();
    });

    it('falls back to a hard delete when soft-delete is disabled', async () => {
      const hardRepo = new WidgetRepository(delegate, { softDelete: false });
      vi.mocked(delegate.delete).mockResolvedValue(row());

      await hardRepo.softDelete('w1');

      expect(delegate.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
      expect(delegate.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes the row permanently', async () => {
      vi.mocked(delegate.delete).mockResolvedValue(row());
      await repository.delete('w1');
      expect(delegate.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
    });
  });

  describe('exists', () => {
    it('returns true when a live row matches', async () => {
      vi.mocked(delegate.count).mockResolvedValue(1);
      expect(await repository.exists('w1')).toBe(true);
      expect(delegate.count).toHaveBeenCalledWith({ where: { id: 'w1', deletedAt: null } });
    });

    it('returns false when no live row matches', async () => {
      vi.mocked(delegate.count).mockResolvedValue(0);
      expect(await repository.exists('w1')).toBe(false);
    });
  });

  describe('count', () => {
    it('applies the soft-delete filter alongside the provided filter', async () => {
      vi.mocked(delegate.count).mockResolvedValue(7);

      const result = await repository.count({ tenantId: 't1' });

      expect(result).toBe(7);
      expect(delegate.count).toHaveBeenCalledWith({
        where: { tenantId: 't1', deletedAt: null },
      });
    });
  });
});
