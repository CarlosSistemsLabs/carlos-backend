import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { VersionedListCache } from '@application/cache/query-cache.js';
import { CUSTOMER_LIST_CACHE_NAMESPACE } from '@application/cache/cache-ttls.js';
import { Email } from '../../domain/value-objects/email.js';
import { Phone } from '../../domain/value-objects/phone.js';
import type { Customer, UpdateContactInput } from '../../domain/entities/customer.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import {
  toCustomerOutput,
  type CustomerOutput,
  type UpdateCustomerInputDto,
} from '../dto/customer-dtos.js';

/**
 * Updates an existing customer (Requirements 9.1, 10.3, 26.1).
 *
 * Loads the customer (404 when missing or owned by another tenant), then applies
 * only the supplied changes. Contact fields are re-validated by rebuilding their
 * value objects. When the email or phone changes to a new, non-null value, its
 * per-tenant uniqueness is re-checked (excluding the customer itself) before the
 * change is committed — an update can never introduce a duplicate contact.
 *
 * **Cache invalidation (task 39.4, Requirement 26.1).** An update can change a
 * customer's name, contact details or active flag — all of which affect cached
 * list/search results — so after a successful persist the tenant's customer-list
 * cache version is bumped, invalidating every cached permutation at once (see
 * {@link VersionedListCache}).
 */
export class UpdateCustomerUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly customers: ICustomerRepository,
    cache: ICache = new NoOpCache(),
  ) {
    this.listCache = new VersionedListCache(cache, CUSTOMER_LIST_CACHE_NAMESPACE, 0);
  }

  async execute(input: UpdateCustomerInputDto): Promise<CustomerOutput> {
    const existing = await this.customers.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Customer', input.id);
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

    const saved = await this.customers.update(existing);
    await this.listCache.invalidate(input.tenantId);
    return toCustomerOutput(saved);
  }

  /** Re-checks per-tenant email uniqueness when the email changes to a new value.  */
  private async assertEmailAvailable(
    existing: Customer,
    input: UpdateCustomerInputDto,
  ): Promise<void> {
    if (input.email === undefined || input.email === null) {
      return;
    }
    const nextEmail = Email.create(input.email);
    const currentEmail = existing.email?.value ?? null;
    if (nextEmail.value === currentEmail) {
      return;
    }
    if (await this.customers.existsByEmail(input.tenantId, nextEmail.value, existing.id)) {
      throw new ConflictError('A customer with this email already exists', {
        field: 'email',
        email: nextEmail.value,
      });
    }
  }

  /** Re-checks per-tenant phone uniqueness when the phone changes to a new value. */
  private async assertPhoneAvailable(
    existing: Customer,
    input: UpdateCustomerInputDto,
  ): Promise<void> {
    if (input.phone === undefined || input.phone === null) {
      return;
    }
    const nextPhone = Phone.create(input.phone);
    const currentPhone = existing.phone?.value ?? null;
    if (nextPhone.value === currentPhone) {
      return;
    }
    if (await this.customers.existsByPhone(input.tenantId, nextPhone.value, existing.id)) {
      throw new ConflictError('A customer with this phone already exists', {
        field: 'phone',
        phone: nextPhone.value,
      });
    }
  }
}
