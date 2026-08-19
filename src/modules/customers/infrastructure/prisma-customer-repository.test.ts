import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrismaCustomerRepository,
  type CustomerPrismaClient,
  type CustomerRow,
} from './prisma-customer-repository.js';
import { Customer } from '../domain/entities/customer.js';

function customerRow(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 'cust-1',
    tenantId: 'tenant-1',
    name: 'Acme Corp',
    email: 'contact@acme.com',
    phone: '+541112345678',
    taxId: '20-12345678-9',
    address: 'Main St 1',
    notes: null,
    isActive: true,
    ...overrides,
  };
}

function makeClient(): CustomerPrismaClient {
  return {
    customer: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async () => customerRow()),
      update: vi.fn(async () => customerRow()),
    },
  };
}

function sampleCustomer(): Customer {
  return Customer.create(
    {
      tenantId: 'tenant-1',
      name: 'Acme Corp',
      email: 'contact@acme.com',
      phone: '+541112345678',
      taxId: '20-12345678-9',
      address: 'Main St 1',
    },
    'cust-1',
  );
}

describe('PrismaCustomerRepository', () => {
  let client: CustomerPrismaClient;
  let repo: PrismaCustomerRepository;

  beforeEach(() => {
    client = makeClient();
    repo = new PrismaCustomerRepository(client);
  });

  it('maps a persistence row to a value-object-bearing domain aggregate', async () => {
    vi.mocked(client.customer.findFirst).mockResolvedValue(customerRow());
    const customer = await repo.findById('cust-1');

    expect(customer).not.toBeNull();
    expect(customer?.name).toBe('Acme Corp');
    expect(customer?.email?.value).toBe('contact@acme.com');
    expect(customer?.phone?.value).toBe('+541112345678');
    expect(customer?.taxId?.value).toBe('20-12345678-9');
  });

  it('maps null contact columns to null value objects', async () => {
    vi.mocked(client.customer.findFirst).mockResolvedValue(
      customerRow({ email: null, phone: null, taxId: null }),
    );
    const customer = await repo.findById('cust-1');
    expect(customer?.email).toBeNull();
    expect(customer?.phone).toBeNull();
    expect(customer?.taxId).toBeNull();
  });

  it('serialises value objects to plain columns when persisting', async () => {
    await repo.create(sampleCustomer());
    const data = vi.mocked(client.customer.create).mock.calls[0]![0].data;
    expect(data).toMatchObject({
      id: 'cust-1',
      tenantId: 'tenant-1',
      name: 'Acme Corp',
      email: 'contact@acme.com',
      phone: '+541112345678',
      taxId: '20-12345678-9',
      isActive: true,
    });
  });

  it('normalises + scopes by tenant and excludes soft-deleted rows on findByEmail', async () => {
    await repo.findByEmail('tenant-1', 'Contact@ACME.com');
    expect(client.customer.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', email: 'contact@acme.com', deletedAt: null },
    });
  });

  it('stamps deletedAt on soft delete', async () => {
    await repo.softDelete('cust-1');
    const args = vi.mocked(client.customer.update).mock.calls[0]![0];
    expect(args.where).toEqual({ id: 'cust-1' });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('builds a case-insensitive multi-field search with pagination + meta', async () => {
    vi.mocked(client.customer.findMany).mockResolvedValue([customerRow()]);
    vi.mocked(client.customer.count).mockResolvedValue(1);

    const result = await repo.findMany('tenant-1', {
      page: 2,
      pageSize: 10,
      filters: { search: 'acme', isActive: true },
      sort: { field: 'name', direction: 'asc' },
    });

    const findArgs = vi.mocked(client.customer.findMany).mock.calls[0]![0];
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
    vi.mocked(client.customer.count).mockResolvedValue(0);
    const exists = await repo.existsByEmail('tenant-1', 'contact@acme.com', 'cust-1');
    expect(client.customer.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        email: 'contact@acme.com',
        deletedAt: null,
        id: { not: 'cust-1' },
      },
    });
    expect(exists).toBe(false);
  });

  it('excludes a given id when checking phone existence (for updates)', async () => {
    vi.mocked(client.customer.count).mockResolvedValue(0);
    await repo.existsByPhone('tenant-1', '+54 11 1234-5678', 'cust-1');
    expect(client.customer.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        phone: '+541112345678',
        deletedAt: null,
        id: { not: 'cust-1' },
      },
    });
  });
});
