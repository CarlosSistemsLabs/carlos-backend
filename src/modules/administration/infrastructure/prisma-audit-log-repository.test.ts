import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaAuditLogRepository,
  type AuditLogPrismaClient,
  type AuditLogRow,
} from './prisma-audit-log-repository.js';

const TENANT_ID = 'tenant-1';

function auditRow(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: 'log-1',
    tenantId: TENANT_ID,
    userId: 'user-1',
    entityType: 'Sale',
    entityId: 'sale-1',
    action: 'CREATE',
    oldValues: null,
    newValues: { total: '100.00' },
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date('2024-01-15T10:00:00.000Z'),
    ...overrides,
  };
}

function makeClient(): AuditLogPrismaClient {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

describe('PrismaAuditLogRepository', () => {
  let client: AuditLogPrismaClient;
  let repo: PrismaAuditLogRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaAuditLogRepository(client);
  });

  it('scopes by tenant, orders newest-first and paginates with skip/take', async () => {
    vi.mocked(client.auditLog.findMany).mockResolvedValue([auditRow()]);
    vi.mocked(client.auditLog.count).mockResolvedValue(1);

    const result = await repo.findMany(TENANT_ID, { page: 2, pageSize: 10 });

    expect(client.auditLog.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      orderBy: { timestamp: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ id: 'log-1', entityType: 'Sale', action: 'CREATE' });
  });

  it('applies entity/user/action filters and a timestamp range', async () => {
    const from = new Date('2024-01-01T00:00:00.000Z');
    const to = new Date('2024-02-01T00:00:00.000Z');

    await repo.findMany(TENANT_ID, {
      page: 1,
      pageSize: 25,
      filters: {
        entityType: 'Product',
        entityId: 'p-1',
        userId: 'user-9',
        action: 'UPDATE',
        from,
        to,
      },
    });

    expect(client.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        entityType: 'Product',
        entityId: 'p-1',
        userId: 'user-9',
        action: 'UPDATE',
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'desc' },
      skip: 0,
      take: 25,
    });
  });

  it('reports zero total pages when there are no matching records', async () => {
    const result = await repo.findMany(TENANT_ID, { page: 1, pageSize: 10 });
    expect(result).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });
});
