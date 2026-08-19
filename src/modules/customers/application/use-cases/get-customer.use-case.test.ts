import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetCustomerUseCase } from './get-customer.use-case.js';
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
    softDelete: vi.fn(),
    existsByEmail: vi.fn(),
    existsByPhone: vi.fn(),
  };
}

describe('GetCustomerUseCase', () => {
  let customers: ICustomerRepository;
  let useCase: GetCustomerUseCase;

  beforeEach(() => {
    customers = makeCustomers();
    useCase = new GetCustomerUseCase(customers);
  });

  it('returns the projected customer when found for the tenant', async () => {
    const result = await useCase.execute({ id: 'cust-1', tenantId: 'tenant-1' });
    expect(result.id).toBe('cust-1');
    expect(result.name).toBe('Acme');
  });

  it('throws NotFoundError when missing', async () => {
    customers = makeCustomers(null);
    useCase = new GetCustomerUseCase(customers);
    await expect(useCase.execute({ id: 'cust-1', tenantId: 'tenant-1' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws NotFoundError when owned by another tenant', async () => {
    await expect(
      useCase.execute({ id: 'cust-1', tenantId: 'other-tenant' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
