import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaConfigurationRepository,
  type ConfigurationPrismaClient,
  type ConfigurationRow,
} from './prisma-configuration-repository.js';

function makeClient(): ConfigurationPrismaClient {
  return {
    configuration: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(async () => ({ key: 'k', value: 1 }) as ConfigurationRow),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

describe('PrismaConfigurationRepository', () => {
  let client: ConfigurationPrismaClient;
  let repo: PrismaConfigurationRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaConfigurationRepository(client);
  });

  it('reads a single entry scoped by tenant + key', async () => {
    vi.mocked(client.configuration.findFirst).mockResolvedValue({ key: 'sales.tax', value: 21 });
    const entry = await repo.get('t1', 'sales.tax');

    expect(client.configuration.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't1', key: 'sales.tax' },
    });
    expect(entry).toEqual({ key: 'sales.tax', value: 21 });
  });

  it('returns null when the entry is absent', async () => {
    vi.mocked(client.configuration.findFirst).mockResolvedValue(null);
    await expect(repo.get('t1', 'missing')).resolves.toBeNull();
  });

  it('upserts on the compound unique key, stamping tenantId in create', async () => {
    const value = { enabled: true, list: [1, 2] };
    vi.mocked(client.configuration.upsert).mockResolvedValue({ key: 'flag', value });

    const entry = await repo.set('t1', 'flag', value);

    expect(client.configuration.upsert).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: 't1', key: 'flag' } },
      create: { tenantId: 't1', key: 'flag', value },
      update: { value },
    });
    expect(entry).toEqual({ key: 'flag', value });
  });

  it('lists entries for a tenant ordered by key', async () => {
    vi.mocked(client.configuration.findMany).mockResolvedValue([
      { key: 'a', value: 1 },
      { key: 'b', value: 'x' },
    ]);

    const entries = await repo.list('t1');

    expect(client.configuration.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      orderBy: { key: 'asc' },
    });
    expect(entries).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: 'x' },
    ]);
  });

  it('deletes via deleteMany so a missing key is a safe no-op', async () => {
    await repo.delete('t1', 'gone');
    expect(client.configuration.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', key: 'gone' },
    });
  });
});
