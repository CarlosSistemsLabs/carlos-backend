import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateCustomerUseCase } from './update-customer.use-case.js';
import { Customer } from '../../domain/entities/customer.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import type { UpdateCustomerInputDto } from '../dto/customer-dtos.js';

function existingCustomer(): Customer {
  return Customer.reconstitute('cust-1', {
    tenantId: 'tenant-1',
    name: 'Acme Corp',
    email: null,
    phone: null,
    taxId: null,
    address: null,
    notes: null,
    isActive: true,
  });
}

function makeCustomers(seed: Customer | null = existingCustomer()): ICustomerRepository {
  return {
    findById: vi.fn().mockResolvedValue(seed),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByPhone: vi.fn().mockResolvedValue(null),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(async (customer: Customer) => customer),
    softDelete: vi.fn(),
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByPhone: vi.fn().mockResolvedValue(false),
  };
}

describe('UpdateCustomerUseCase', () => {
  let customers: ICustomerRepository;
  let useCase: UpdateCustomerUseCase;

  beforeEach(() => {
    customers = makeCustomers();
    useCase = new UpdateCustomerUseCase(customers);
  });

  const baseInput: UpdateCustomerInputDto = { id: 'cust-1', tenantId: 'tenant-1' };

  it('renames and sets a new email, re-checking uniqueness (excluding self)', async () => {
    const result = await useCase.execute({ ...baseInput, name: 'Acme SA', email: 'new@acme.com' });
    expect(customers.existsByEmail).toHaveBeenCalledWith('tenant-1', 'new@acme.com', 'cust-1');
    expect(customers.update).toHaveBeenCalledOnce();
    expect(result.name).toBe('Acme SA');
    expect(result.email).toBe('new@acme.com');
  });

  it('throws NotFoundError when the customer does not exist', async () => {
    customers = makeCustomers(null);
    useCase = new UpdateCustomerUseCase(customers);
    await expect(useCase.execute({ ...baseInput, name: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws NotFoundError when the customer belongs to another tenant', async () => {
    await expect(
      useCase.execute({ id: 'cust-1', tenantId: 'other-tenant', name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(customers.update).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the new email is taken by another customer', async () => {
    vi.mocked(customers.existsByEmail).mockResolvedValue(true);
    await expect(useCase.execute({ ...baseInput, email: 'taken@acme.com' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(customers.update).not.toHaveBeenCalled();
  });

  it('does not re-check uniqueness when the email is unchanged', async () => {
    customers = makeCustomers(
      Customer.reconstitute('cust-1', {
        tenantId: 'tenant-1',
        name: 'Acme',
        email: null,
        phone: null,
        taxId: null,
        address: null,
        notes: null,
        isActive: true,
      }),
    );
    // Seed already has email a@b.com by mutating via updateContact.
    const seeded = await customers.findById('cust-1');
    seeded?.updateContact({ email: 'same@acme.com' });
    vi.mocked(customers.findById).mockResolvedValue(seeded);
    useCase = new UpdateCustomerUseCase(customers);

    await useCase.execute({ ...baseInput, email: 'SAME@acme.com' });
    expect(customers.existsByEmail).not.toHaveBeenCalled();
    expect(customers.update).toHaveBeenCalledOnce();
  });

  it('clears the phone when null is supplied without a uniqueness check', async () => {
    const result = await useCase.execute({ ...baseInput, phone: null });
    expect(customers.existsByPhone).not.toHaveBeenCalled();
    expect(result.phone).toBeNull();
  });

  it('deactivates the customer when isActive is false', async () => {
    const result = await useCase.execute({ ...baseInput, isActive: false });
    expect(result.isActive).toBe(false);
  });
});
