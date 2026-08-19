import { ConflictError } from '@domain/errors/index.js';
import { Supplier } from '../../domain/entities/supplier.js';
import { Email } from '../../domain/value-objects/email.js';
import { Phone } from '../../domain/value-objects/phone.js';
import { TaxId } from '../../domain/value-objects/tax-id.js';
import type { ISupplierRepository } from '../../domain/repositories/supplier-repository.js';
import {
  toSupplierOutput,
  type CreateSupplierInputDto,
  type SupplierOutput,
} from '../dto/supplier-dtos.js';

/**
 * Creates a new supplier within a tenant (Requirements 9.1, 10.3).
 *
 * Enforces the cross-aggregate invariants the {@link Supplier} entity cannot see
 * on its own: when an email and/or phone is supplied it must be unique *per
 * tenant*. Contact values are parsed into their value objects first so the
 * uniqueness check runs against the same normalised form the repository stores
 * (e.g. `"A@B.com"` and `"a@b.com"` collide).
 */
export class CreateSupplierUseCase {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(input: CreateSupplierInputDto): Promise<SupplierOutput> {
    const email =
      input.email === undefined || input.email === null ? null : Email.create(input.email);
    const phone =
      input.phone === undefined || input.phone === null ? null : Phone.create(input.phone);
    const taxId =
      input.taxId === undefined || input.taxId === null ? null : TaxId.create(input.taxId);

    // Per-tenant email uniqueness (cross-aggregate invariant).
    if (email !== null && (await this.suppliers.existsByEmail(input.tenantId, email.value))) {
      throw new ConflictError('A supplier with this email already exists', {
        field: 'email',
        email: email.value,
      });
    }

    // Per-tenant phone uniqueness (cross-aggregate invariant).
    if (phone !== null && (await this.suppliers.existsByPhone(input.tenantId, phone.value))) {
      throw new ConflictError('A supplier with this phone already exists', {
        field: 'phone',
        phone: phone.value,
      });
    }

    const supplier = Supplier.create({
      tenantId: input.tenantId,
      name: input.name,
      email,
      phone,
      taxId,
      address: input.address ?? null,
      notes: input.notes ?? null,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });

    const saved = await this.suppliers.create(supplier);
    return toSupplierOutput(saved);
  }
}
