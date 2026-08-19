import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateSupplierUseCase } from './update-supplier.use-case.js';
import { Supplier } from '../../domain/entities/supplier.js';
import type { ISupplierRepository } from '../../domain/repositories/supplier-repository.js';
import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import type { UpdateSupplierInputDto } from '../dto/supplier-dtos.js';

function existingSupplier(): Supplier {
  return Supplier.reconstitute('sup-1', {
    tenantId: 'tenant-1',
    name: 'Acme Supplies',
    email: null,
    phone: null,
    taxId: null,
    address: null,
    notes: null,
    isActive: true,
  });
}

function makeSuppliers(seed: Supplier | null = existingSupplier()): ISupplierRepository {
  return {
    findById: vi.fn().mockResolvedValue(seed),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByPhone: vi.fn().mockResolvedValue(null),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(async (supplier: Supplier) => supplier),
    softDelete: vi.fn(),
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByPhone: vi.fn().mockResolvedValue(false),
  };
}

describe('UpdateSupplierUseCase', () => {
  let suppliers: ISupplierRepository;
  let useCase: UpdateSupplierUseCase;

  beforeEach(() => {
    suppliers = makeSuppliers();
    useCase = new UpdateSupplierUseCase(suppliers);
  });

  const baseInput: UpdateSupplierInputDto = { id: 'sup-1', tenantId: 'tenant-1' };

  it('renames and sets a new email, re-checking uniqueness (excluding self)', async () => {
    const result = await useCase.execute({ ...baseInput, name: 'Acme SA', email: 'new@acme.com' });
    expect(suppliers.existsByEmail).toHaveBeenCalledWith('tenant-1', 'new@acme.com', 'sup-1');
    expect(suppliers.update).toHaveBeenCalledOnce();
    expect(result.name).toBe('Acme SA');
    expect(result.email).toBe('new@acme.com');
  });

  it('throws NotFoundError when the supplier does not exist', async () => {
    suppliers = makeSuppliers(null);
    useCase = new UpdateSupplierUseCase(suppliers);
    await expect(useCase.execute({ ...baseInput, name: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws NotFoundError when the supplier belongs to another tenant', async () => {
    await expect(
      useCase.execute({ id: 'sup-1', tenantId: 'other-tenant', name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(suppliers.update).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the new email is taken by another supplier', async () => {
    vi.mocked(suppliers.existsByEmail).mockResolvedValue(true);
    await expect(useCase.execute({ ...baseInput, email: 'taken@acme.com' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(suppliers.update).not.toHaveBeenCalled();
  });

  it('does not re-check uniqueness when the email is unchanged', async () => {
    const seeded = existingSupplier();
    seeded.updateContact({ email: 'same@acme.com' });
    suppliers = makeSuppliers(seeded);
    useCase = new UpdateSupplierUseCase(suppliers);

    await useCase.execute({ ...baseInput, email: 'SAME@acme.com' });
    expect(suppliers.existsByEmail).not.toHaveBeenCalled();
    expect(suppliers.update).toHaveBeenCalledOnce();
  });

  it('clears the phone when null is supplied without a uniqueness check', async () => {
    const result = await useCase.execute({ ...baseInput, phone: null });
    expect(suppliers.existsByPhone).not.toHaveBeenCalled();
    expect(result.phone).toBeNull();
  });

  it('deactivates the supplier when isActive is false', async () => {
    const result = await useCase.execute({ ...baseInput, isActive: false });
    expect(result.isActive).toBe(false);
  });
});
