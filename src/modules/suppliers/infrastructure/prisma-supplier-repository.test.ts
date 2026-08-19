import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaSupplierRepository,
  type SupplierPrismaClient,
  type SupplierRow,
} from './prisma-supplier-repository.js';
import { Supplier } from '../domain/entities/supplier.js';

function supplierRow(overrides: Partial<SupplierRow> = {}): SupplierRow {
  return {
    id: 'sup-1',
    tenantId: 'tenant-1',
    name: 'Acme Supplies',
    email: 'contact@acme.com',
    phone: '+541112345678',
    taxId: '20-12345678-9',
    address: 'Main St 1',
    notes: null,
    isActive: true,
    ...overrides,
  };
}

function makeClient(): SupplierPrismaClient {
  return {
    supplier: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async () => supplierRow()),
      update: vi.fn(async () => supplierRow()),
    },
  };
}

function sampleSupplier(): Supplier {
  return Supplier.create(
    {
      tenantId: 'tenant-1',
      name: 'Acme Supplies',
      email: 'contact@acme.com',
      phone: '+541112345678',
      taxId: '20-12345678-9',
      address: 'Main St 1',
    },
    'sup-1',
  );
}

describe('PrismaSupplierRepository', () => {
  let client: SupplierPrismaClient;
  let repo: PrismaSupplierRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaSupplierRepository(client);
  });

  it('maps a persistence row to a value-object-bearing domain aggregate', async () => {
    vi.mocked(client.supplier.findFirst).mockResolvedValue(supplierRow());
    const supplier = await repo.findById('sup-1');

    expect(supplier).not.toBeNull();
    expect(supplier?.name).toBe('Acme Supplies');
    expect(supplier?.email?.value).toBe('contact@acme.com');
    expect(supplier?.phone?.value).toBe('+541112345678');
    expect(supplier?.taxId?.value).toBe('20-12345678-9');
  });

  it('maps null contact columns to null value objects', async () => {
    vi.mocked(client.supplier.findFirst).mockResolvedValue(
      supplierRow({ email: null, phone: null, taxId: null }),
    );
    const supplier = await repo.findById('sup-1');
    expect(supplier?.email).toBeNull();
    expect(supplier?.phone).toBeNull();
    expect(supplier?.taxId).toBeNull();
  });

  it('serialises value objects to plain columns when persisting', async () => {
    await repo.create(sampleSupplier());
    const data = vi.mocked(client.supplier.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      id: 'sup-1',
      tenantId: 'tenant-1',
      name: 'Acme Supplies',
      email: 'contact@acme.com',
      phone: '+541112345678',
      taxId: '20-12345678-9',
      isActive: true,
    });
  });

  it('normalises + scopes by tenant and excludes soft-deleted rows on findByEmail', async () => {
    await repo.findByEmail('tenant-1', 'Contact@ACME.com');
    expect(client.supplier.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', email: 'contact@acme.com', deletedAt: null },
    });
  });

  it('stamps deletedAt on soft delete', async () => {
    await repo.softDelete('sup-1');
    const args = vi.mocked(client.supplier.update).mock.calls[0]![0];
    expect(args.where).toEqual({ id: 'sup-1' });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('builds a case-insensitive multi-field search with pagination + meta', async () => {
    vi.mocked(client.supplier.findMany).mockResolvedValue([supplierRow()]);
    vi.mocked(client.supplier.count).mockResolvedValue(1);

    const result = await repo.findMany('tenant-1', {
      page: 2,
      pageSize: 10,
      filters: { search: 'acme', isActive: true },
      sort: { field: 'name', direction: 'asc' },
    });

    const findArgs = vi.mocked(client.supplier.findMany).mock.calls[0]![0];
    expect(findArgs.where).toEqual({
      tenantId: 'tenant-1',
      deletedAt: null,
      isActive: true,
      OR: [
        { name: { contains: 'acme', mode: 'insensitive' } },
        { email: { contains: 'acme', mode: 'insensitive' } },
        { phone: { contains: 'acme', mode: 'insensitive' } },
        { taxId: { contains: 'acme', mode: 'insensitive' } },
      ],
    });
    expect(findArgs.skip).toBe(10);
    expect(findArgs.take).toBe(10);
    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10, totalPages: 1 });
    expect(result.items).toHaveLength(1);
  });

  it('excludes a given id when checking email existence (for updates)', async () => {
    vi.mocked(client.supplier.count).mockResolvedValue(0);
    const exists = await repo.existsByEmail('tenant-1', 'contact@acme.com', 'sup-1');
    expect(client.supplier.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        email: 'contact@acme.com',
        deletedAt: null,
        id: { not: 'sup-1' },
      },
    });
    expect(exists).toBe(false);
  });

  it('excludes a given id when checking phone existence (for updates)', async () => {
    vi.mocked(client.supplier.count).mockResolvedValue(0);
    await repo.existsByPhone('tenant-1', '+54 11 1234-5678', 'sup-1');
    expect(client.supplier.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        phone: '+541112345678',
        deletedAt: null,
        id: { not: 'sup-1' },
      },
    });
  });
});
