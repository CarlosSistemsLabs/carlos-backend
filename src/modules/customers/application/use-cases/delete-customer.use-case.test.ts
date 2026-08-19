import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteCustomerUseCase } from './delete-customer.use-case.js';
import { Customer } from '../../domain/entities/customer.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import { NotFoundError } from '@domain/errors/index.js';

function existing(): Customer {
  return Customer.reconstitute('cust-1', {
    tenantId: 'tenant-1',
    name: 'Acme',
    email: null,
    phone: null,
    taxId: null,
    address: null,
    notes: null,
    isActive: true,
  });
}

function makeCustomers(seed: Customer | null = existing()): ICustomerRepository {
  return {
    findById: vi.fn().mockResolvedValue(seed),
    findByEmail: vi.fn(),
    findByPhone: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn().mockResolvedValue(undefined),
    existsByEmail: vi.fn(),
    existsByPhone: vi.fn(),
  };
}

describe('DeleteCustomerUseCase', () => {
  let customers: ICustomerRepository;
  let useCase: DeleteCustomerUseCase;

  beforeEach(() => {
    customers = makeCustomers();
    useCase = new DeleteCustomerUseCase(customers);
  });

  it('soft-deletes an existing customer', async () => {
    await useCase.execute({ id: 'cust-1', tenantId: 'tenant-1' });
    expect(customers.softDelete).toHaveBeenCalledWith('cust-1');
  });

  it('throws NotFoundError when the customer is missing', async () => {
    customers = makeCustomers(null);
    useCase = new DeleteCustomerUseCase(customers);
    await expect(useCase.execute({ id: 'cust-1', tenantId: 'tenant-1' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(customers.softDelete).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the customer belongs to another tenant', async () => {
    await expect(
      useCase.execute({ id: 'cust-1', tenantId: 'other-tenant' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(customers.softDelete).not.toHaveBeenCalled();
  });
});
