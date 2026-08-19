import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICache } from '@application/ports/cache.js';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { ListCustomersUseCase } from './list-customers.use-case.js';
import { SearchCustomersUseCase } from './search-customers.use-case.js';
import { CreateCustomerUseCase } from './create-customer.use-case.js';
import { UpdateCustomerUseCase } from './update-customer.use-case.js';
import { DeleteCustomerUseCase } from './delete-customer.use-case.js';
import { Customer } from '../../domain/entities/customer.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import type { PaginatedResult } from '@shared/types/index.js';

const TENANT = 'tenant-1';

function customer(id: string, name: string): Customer {
  return Customer.create({ tenantId: TENANT, name }, id);
}

function pageOf(items: Customer[]): PaginatedResult<Customer> {
  return { items, total: items.length, page: 1, pageSize: 20, totalPages: 1 };
}

function makeCustomers(result: PaginatedResult<Customer>): ICustomerRepository {
  return {
    findById: vi.fn().mockResolvedValue(customer('C1', 'Acme')),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByPhone: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue(result),
    create: vi.fn(async (c: Customer) => c),
    update: vi.fn(async (c: Customer) => c),
    softDelete: vi.fn().mockResolvedValue(undefined),
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByPhone: vi.fn().mockResolvedValue(false),
  };
}

describe('ListCustomersUseCase caching', () => {
  let customers: ICustomerRepository;
  let cache: InMemoryCache;

  beforeEach(() => {
    customers = makeCustomers(pageOf([customer('C1', 'Acme')]));
    cache = new InMemoryCache();
  });

  it('serves a repeated identical listing from cache (repo hit once)', async () => {
    const useCase = new ListCustomersUseCase(customers, cache);
    await useCase.execute({ tenantId: TENANT, page: 1 });
    await useCase.execute({ tenantId: TENANT, page: 1 });
    expect(customers.findMany).toHaveBeenCalledOnce();
  });

  it('caches distinct query params independently', async () => {
    const useCase = new ListCustomersUseCase(customers, cache);
    await useCase.execute({ tenantId: TENANT, isActive: true });
    await useCase.execute({ tenantId: TENANT, isActive: false });
    expect(customers.findMany).toHaveBeenCalledTimes(2);
  });

  it('populates the cache honouring the configured TTL', async () => {
    let now = 1000;
    cache = new InMemoryCache(() => now);
    const useCase = new ListCustomersUseCase(customers, cache, 30);
    await useCase.execute({ tenantId: TENANT, page: 1 });
    now += 31_000;
    await useCase.execute({ tenantId: TENANT, page: 1 });
    expect(customers.findMany).toHaveBeenCalledTimes(2);
  });

  it('still returns correct data when the cache throws', async () => {
    const throwing: ICache = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      del: vi.fn().mockRejectedValue(new Error('down')),
    };
    const useCase = new ListCustomersUseCase(customers, throwing);
    const result = await useCase.execute({ tenantId: TENANT, page: 1 });
    expect(result.items[0]?.name).toBe('Acme');
    expect(customers.findMany).toHaveBeenCalledOnce();
  });
});

describe('SearchCustomersUseCase caching', () => {
  it('shares invalidation with the list but keeps distinct entries', async () => {
    const customers = makeCustomers(pageOf([customer('C1', 'Acme')]));
    const cache = new InMemoryCache();
    const list = new ListCustomersUseCase(customers, cache);
    const search = new SearchCustomersUseCase(customers, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await search.execute({ tenantId: TENANT, term: 'acme', page: 1 });
    await search.execute({ tenantId: TENANT, term: 'acme', page: 1 });

    // list + first search miss (2), second search is a hit.
    expect(customers.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('customer mutations invalidate the cached lists', () => {
  let customers: ICustomerRepository;
  let cache: InMemoryCache;

  beforeEach(() => {
    customers = makeCustomers(pageOf([customer('C1', 'Acme')]));
    cache = new InMemoryCache();
  });

  it('create invalidates the cached listing', async () => {
    const list = new ListCustomersUseCase(customers, cache);
    const create = new CreateCustomerUseCase(customers, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await create.execute({ tenantId: TENANT, name: 'New Corp' });
    await list.execute({ tenantId: TENANT, page: 1 });

    expect(customers.findMany).toHaveBeenCalledTimes(2);
  });

  it('update invalidates the cached listing', async () => {
    const list = new ListCustomersUseCase(customers, cache);
    const update = new UpdateCustomerUseCase(customers, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await update.execute({ id: 'C1', tenantId: TENANT, name: 'Renamed' });
    await list.execute({ tenantId: TENANT, page: 1 });

    expect(customers.findMany).toHaveBeenCalledTimes(2);
  });

  it('delete invalidates the cached listing', async () => {
    const list = new ListCustomersUseCase(customers, cache);
    const del = new DeleteCustomerUseCase(customers, cache);

    await list.execute({ tenantId: TENANT, page: 1 });
    await del.execute({ id: 'C1', tenantId: TENANT });
    await list.execute({ tenantId: TENANT, page: 1 });

    expect(customers.findMany).toHaveBeenCalledTimes(2);
  });
});
