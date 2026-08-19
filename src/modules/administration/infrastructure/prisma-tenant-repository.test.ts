import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaTenantRepository,
  type TenantPrismaClient,
  type TenantRow,
} from './prisma-tenant-repository.js';
import { Tenant } from '../domain/entities/tenant.js';

function tenantRow(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: 'tenant-1',
    name: 'Acme Inc',
    slug: 'acme',
    logo: 'https://cdn/logo.png',
    primaryColor: '#ff00aa',
    secondaryColor: null,
    theme: 'dark',
    language: 'es',
    timezone: 'America/Argentina/Buenos_Aires',
    currency: 'ARS',
    dateFormat: 'DD/MM/YYYY',
    taxId: '20-12345678-9',
    ...overrides,
  };
}

function makeClient(): TenantPrismaClient {
  return {
    tenant: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async () => tenantRow()),
      update: vi.fn(async () => tenantRow()),
    },
  };
}

describe('PrismaTenantRepository', () => {
  let client: TenantPrismaClient;
  let repo: PrismaTenantRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaTenantRepository(client);
  });

  it('maps a persistence row to a value-object-bearing tenant', async () => {
    vi.mocked(client.tenant.findFirst).mockResolvedValue(tenantRow());
    const tenant = await repo.findById('tenant-1');

    expect(tenant).not.toBeNull();
    expect(tenant?.name).toBe('Acme Inc');
    expect(tenant?.primaryColor?.value).toBe('#ff00aa');
    expect(tenant?.secondaryColor).toBeNull();
    expect(tenant?.theme.value).toBe('dark');
  });

  it('scopes findById to non-deleted rows', async () => {
    await repo.findById('tenant-1');
    expect(client.tenant.findFirst).toHaveBeenCalledWith({
      where: { id: 'tenant-1', deletedAt: null },
    });
  });

  it('scopes findBySlug to non-deleted rows', async () => {
    await repo.findBySlug('acme');
    expect(client.tenant.findFirst).toHaveBeenCalledWith({
      where: { slug: 'acme', deletedAt: null },
    });
  });

  it('serialises value objects to plain columns when persisting (with id)', async () => {
    const tenant = Tenant.create(
      { name: 'Acme Inc', slug: 'acme', primaryColor: '#f0a', theme: 'dark', taxId: '20-1' },
      'tenant-1',
    );
    await repo.create(tenant);

    const data = vi.mocked(client.tenant.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      id: 'tenant-1',
      name: 'Acme Inc',
      slug: 'acme',
      primaryColor: '#ff00aa',
      theme: 'dark',
      taxId: '20-1',
    });
  });

  it('stamps deletedAt on soft delete', async () => {
    await repo.softDelete('tenant-1');
    const args = vi.mocked(client.tenant.update).mock.calls[0]![0];
    expect(args.where).toEqual({ id: 'tenant-1' });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('does not attempt to change the id on update', async () => {
    const tenant = Tenant.create({ name: 'Acme', slug: 'acme' }, 'tenant-1');
    await repo.update(tenant);
    const data = vi.mocked(client.tenant.update).mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('id');
  });
});
