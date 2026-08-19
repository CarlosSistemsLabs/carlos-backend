import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListCustomersUseCase } from './list-customers.use-case.js';
import { Customer } from '../../domain/entities/customer.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import type { PaginatedResult } from '@shared/types/index.js';

function emptyPage(page: number, pageSize: number): PaginatedResult<Customer> {
  return { items: [], total: 0, page, pageSize, totalPages: 0 };
}

function makeCustomers(): ICustomerRepository {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByPhone: vi.fn(),
    findMany: vi.fn(async (_tenantId, query) => emptyPage(query.page, query.pageSize)),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsByEmail: vi.fn(),
    existsByPhone: vi.fn(),
  };
}

describe('ListCustomersUseCase', () => {
  let customers: ICustomerRepository;
  let useCase: ListCustomersUseCase;

  beforeEach(() => {
    customers = makeCustomers();
    useCase = new ListCustomersUseCase(customers);
  });

  it('clamps an over-large pageSize to the platform maximum (100)', async () => {
    await useCase.execute({ tenantId: 'tenant-1', page: 1, pageSize: 5000 });
    const query = vi.mocked(customers.findMany).mock.calls[0]![1];
    expect(query.pageSize).toBe(100);
  });

  it('defaults page/pageSize when omitted', async () => {
    await useCase.execute({ tenantId: 'tenant-1' });
    const query = vi.mocked(customers.findMany).mock.calls[0]![1];
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(20);
  });

  it('passes the isActive filter and sort through to the repository', async () => {
    await useCase.execute({
      tenantId: 'tenant-1',
      isActive: true,
      sortBy: 'name',
      sortDirection: 'desc',
    });
    const query = vi.mocked(customers.findMany).mock.calls[0]![1];
    expect(query.filters).toEqual({ isActive: true });
    expect(query.sort).toEqual({ field: 'name', direction: 'desc' });
  });

  it('returns projected paged output metadata', async () => {
    vi.mocked(customers.findMany).mockResolvedValue({
      items: [Customer.create({ tenantId: 'tenant-1', name: 'Acme' })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const result = await useCase.execute({ tenantId: 'tenant-1' });
    expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    expect(result.items[0]?.name).toBe('Acme');
  });
});
