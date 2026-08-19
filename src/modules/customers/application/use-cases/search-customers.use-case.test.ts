import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchCustomersUseCase } from './search-customers.use-case.js';
import { Customer } from '../../domain/entities/customer.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import type { PaginatedResult } from '@shared/types/index.js';

function makeCustomers(): ICustomerRepository {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByPhone: vi.fn(),
    findMany: vi.fn(
      async (_tenantId, query): Promise<PaginatedResult<Customer>> => ({
        items: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: 0,
      }),
    ),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsByEmail: vi.fn(),
    existsByPhone: vi.fn(),
  };
}

describe('SearchCustomersUseCase', () => {
  let customers: ICustomerRepository;
  let useCase: SearchCustomersUseCase;

  beforeEach(() => {
    customers = makeCustomers();
    useCase = new SearchCustomersUseCase(customers);
  });

  it('passes a trimmed search term and a name-ascending sort to the repository', async () => {
    await useCase.execute({ tenantId: 'tenant-1', term: '  acme  ' });
    const query = vi.mocked(customers.findMany).mock.calls[0]![1];
    expect(query.filters).toEqual({ search: 'acme' });
    expect(query.sort).toEqual({ field: 'name', direction: 'asc' });
  });

  it('degrades an empty term to an unfiltered (but paginated) listing', async () => {
    await useCase.execute({ tenantId: 'tenant-1', term: '   ' });
    const query = vi.mocked(customers.findMany).mock.calls[0]![1];
    expect(query.filters).toEqual({});
    expect(query.pageSize).toBe(20);
  });

  it('combines the term with an isActive filter', async () => {
    await useCase.execute({ tenantId: 'tenant-1', term: 'corp', isActive: false });
    const query = vi.mocked(customers.findMany).mock.calls[0]![1];
    expect(query.filters).toEqual({ search: 'corp', isActive: false });
  });

  it('returns matching customers projected to output', async () => {
    vi.mocked(customers.findMany).mockResolvedValue({
      items: [Customer.create({ tenantId: 'tenant-1', name: 'Acme Corp', email: 'a@acme.com' })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const result = await useCase.execute({ tenantId: 'tenant-1', term: 'acme' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.email).toBe('a@acme.com');
  });
});
