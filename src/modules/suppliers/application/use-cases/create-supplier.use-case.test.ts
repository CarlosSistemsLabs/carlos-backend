import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateSupplierUseCase } from './create-supplier.use-case.js';
import type { Supplier } from '../../domain/entities/supplier.js';
import type { ISupplierRepository } from '../../domain/repositories/supplier-repository.js';
import { ConflictError, ValidationError } from '@domain/errors/index.js';
import type { CreateSupplierInputDto } from '../dto/supplier-dtos.js';

function makeSuppliers(): ISupplierRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByPhone: vi.fn().mockResolvedValue(null),
    findMany: vi.fn(),
    create: vi.fn(async (supplier: Supplier) => supplier),
    update: vi.fn(async (supplier: Supplier) => supplier),
    softDelete: vi.fn().mockResolvedValue(undefined),
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByPhone: vi.fn().mockResolvedValue(false),
  };
}

const input: CreateSupplierInputDto = {
  tenantId: 'tenant-1',
  name: 'Acme Supplies',
  email: 'Contact@Acme.COM',
  phone: '+54 11 1234-5678',
  taxId: '20-12345678-9',
};

describe('CreateSupplierUseCase', () => {
  let suppliers: ISupplierRepository;
  let useCase: CreateSupplierUseCase;

  beforeEach(() => {
    suppliers = makeSuppliers();
    useCase = new CreateSupplierUseCase(suppliers);
  });

  it('creates a supplier, normalising contact details in the output', async () => {
    const result = await useCase.execute(input);

    expect(suppliers.existsByEmail).toHaveBeenCalledWith('tenant-1', 'contact@acme.com');
    expect(suppliers.existsByPhone).toHaveBeenCalledWith('tenant-1', '+541112345678');
    expect(suppliers.create).toHaveBeenCalledOnce();
    expect(result.name).toBe('Acme Supplies');
    expect(result.email).toBe('contact@acme.com');
    expect(result.phone).toBe('+541112345678');
    expect(result.taxId).toBe('20-12345678-9');
    expect(result.isActive).toBe(true);
  });

  it('creates a supplier with no contact details (all optional)', async () => {
    const result = await useCase.execute({ tenantId: 'tenant-1', name: 'Cash supplier' });
    expect(suppliers.existsByEmail).not.toHaveBeenCalled();
    expect(suppliers.existsByPhone).not.toHaveBeenCalled();
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
  });

  it('throws ConflictError when the email already exists for the tenant', async () => {
    vi.mocked(suppliers.existsByEmail).mockResolvedValue(true);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(suppliers.create).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the phone already exists for the tenant', async () => {
    vi.mocked(suppliers.existsByPhone).mockResolvedValue(true);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(suppliers.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed email before touching the repository', async () => {
    await expect(
      useCase.execute({ tenantId: 'tenant-1', name: 'X', email: 'nope' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(suppliers.existsByEmail).not.toHaveBeenCalled();
    expect(suppliers.create).not.toHaveBeenCalled();
  });
});
