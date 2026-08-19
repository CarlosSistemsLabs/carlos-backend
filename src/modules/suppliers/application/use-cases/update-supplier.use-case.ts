import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import { Email } from '../../domain/value-objects/email.js';
import { Phone } from '../../domain/value-objects/phone.js';
import type { Supplier, UpdateContactInput } from '../../domain/entities/supplier.js';
import type { ISupplierRepository } from '../../domain/repositories/supplier-repository.js';
import {
  toSupplierOutput,
  type SupplierOutput,
  type UpdateSupplierInputDto,
} from '../dto/supplier-dtos.js';

/**
 * Updates an existing supplier (Requirements 9.1, 10.3).
 *
 * Loads the supplier (404 when missing or owned by another tenant), then applies
 * only the supplied changes. Contact fields are re-validated by rebuilding their
 * value objects. When the email or phone changes to a new, non-null value, its
 * per-tenant uniqueness is re-checked (excluding the supplier itself) before the
 * change is committed — an update can never introduce a duplicate contact.
 */
export class UpdateSupplierUseCase {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(input: UpdateSupplierInputDto): Promise<SupplierOutput> {
    const existing = await this.suppliers.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Supplier', input.id);
    }

    await this.assertEmailAvailable(existing, input);
    await this.assertPhoneAvailable(existing, input);

    if (input.name !== undefined) {
      existing.rename(input.name);
    }

    const contact: UpdateContactInput = {};
    if (input.email !== undefined) {
      contact.email = input.email;
    }
    if (input.phone !== undefined) {
      contact.phone = input.phone;
    }
    if (input.taxId !== undefined) {
      contact.taxId = input.taxId;
    }
    if (input.address !== undefined) {
      contact.address = input.address;
    }
    if (input.notes !== undefined) {
      contact.notes = input.notes;
    }
    existing.updateContact(contact);

    if (input.isActive !== undefined) {
      if (input.isActive) {
        existing.activate();
      } else {
        existing.deactivate();
      }
    }

    const saved = await this.suppliers.update(existing);
    return toSupplierOutput(saved);
  }

  /** Re-checks per-tenant email uniqueness when the email changes to a new value.  */
  private async assertEmailAvailable(
    existing: Supplier,
    input: UpdateSupplierInputDto,
  ): Promise<void> {
    if (input.email === undefined || input.email === null) {
      return;
    }
    const nextEmail = Email.create(input.email);
    const currentEmail = existing.email?.value ?? null;
    if (nextEmail.value === currentEmail) {
      return;
    }
    if (await this.suppliers.existsByEmail(input.tenantId, nextEmail.value, existing.id)) {
      throw new ConflictError('A supplier with this email already exists', {
        field: 'email',
        email: nextEmail.value,
      });
    }
  }

  /** Re-checks per-tenant phone uniqueness when the phone changes to a new value. */
  private async assertPhoneAvailable(
    existing: Supplier,
    input: UpdateSupplierInputDto,
  ): Promise<void> {
    if (input.phone === undefined || input.phone === null) {
      return;
    }
    const nextPhone = Phone.create(input.phone);
    const currentPhone = existing.phone?.value ?? null;
    if (nextPhone.value === currentPhone) {
      return;
    }
    if (await this.suppliers.existsByPhone(input.tenantId, nextPhone.value, existing.id)) {
      throw new ConflictError('A supplier with this phone already exists', {
        field: 'phone',
        phone: nextPhone.value,
      });
    }
  }
}
