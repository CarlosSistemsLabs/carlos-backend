import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateCustomerUseCase } from './create-customer.use-case.js';
import type { Customer } from '../../domain/entities/customer.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import { ConflictError, ValidationError } from '@domain/errors/index.js';
import type { CreateCustomerInputDto } from '../dto/customer-dtos.js';

function makeCustomers(): ICustomerRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByPhone: vi.fn().mockResolvedValue(null),
    findMany: vi.fn(),
    create: vi.fn(async (customer: Customer) => customer),
    update: vi.fn(async (customer: Customer) => customer),
    softDelete: vi.fn().mockResolvedValue(undefined),
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByPhone: vi.fn().mockResolvedValue(false),
  };
}

const input: CreateCustomerInputDto = {
  tenantId: 'tenant-1',
  name: 'Acme Corp',
  email: 'Contact@Acme.COM',
  phone: '+54 11 1234-5678',
  taxId: '20-12345678-9',
};

describe('CreateCustomerUseCase', () => {
  let customers: ICustomerRepository;
  let useCase: CreateCustomerUseCase;

  beforeEach(() => {
    customers = makeCustomers();
    useCase = new CreateCustomerUseCase(customers);
  });

  it('creates a customer, normalising contact details in the output', async () => {
    const result = await useCase.execute(input);

    expect(customers.existsByEmail).toHaveBeenCalledWith('tenant-1', 'contact@acme.com');
    expect(customers.existsByPhone).toHaveBeenCalledWith('tenant-1', '+541112345678');
    expect(customers.create).toHaveBeenCalledOnce();
    expect(result.name).toBe('Acme Corp');
    expect(result.email).toBe('contact@acme.com');
    expect(result.phone).toBe('+541112345678');
    expect(result.taxId).toBe('20-12345678-9');
    expect(result.isActive).toBe(true);
  });

  it('creates a customer with no contact details (all optional)', async () => {
    const result = await useCase.execute({ tenantId: 'tenant-1', name: 'Walk-in' });
    expect(customers.existsByEmail).not.toHaveBeenCalled();
    expect(customers.existsByPhone).not.toHaveBeenCalled();
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
  });

  it('throws ConflictError when the email already exists for the tenant', async () => {
    vi.mocked(customers.existsByEmail).mockResolvedValue(true);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(customers.create).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the phone already exists for the tenant', async () => {
    vi.mocked(customers.existsByPhone).mockResolvedValue(true);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(customers.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed email before touching the repository', async () => {
    await expect(
      useCase.execute({ tenantId: 'tenant-1', name: 'X', email: 'nope' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(customers.existsByEmail).not.toHaveBeenCalled();
    expect(customers.create).not.toHaveBeenCalled();
  });
});
