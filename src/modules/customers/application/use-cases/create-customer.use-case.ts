import { ConflictError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { VersionedListCache } from '@application/cache/query-cache.js';
import { CUSTOMER_LIST_CACHE_NAMESPACE } from '@application/cache/cache-ttls.js';
import { Customer } from '../../domain/entities/customer.js';
import { Email } from '../../domain/value-objects/email.js';
import { Phone } from '../../domain/value-objects/phone.js';
import { TaxId } from '../../domain/value-objects/tax-id.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import {
  toCustomerOutput,
  type CreateCustomerInputDto,
  type CustomerOutput,
} from '../dto/customer-dtos.js';

/**
 * Creates a new customer within a tenant (Requirements 9.1, 10.3, 26.1).
 *
 * Enforces the cross-aggregate invariants the {@link Customer} entity cannot see
 * on its own: when an email and/or phone is supplied it must be unique *per
 * tenant*. Contact values are parsed into their value objects first so the
 * uniqueness check runs against the same normalised form the repository stores
 * (e.g. `"A@B.com"` and `"a@b.com"` collide).
 *
 * **Cache invalidation (task 39.4, Requirement 26.1).** A new customer changes
 * every customer list/search result for the tenant, so after a successful
 * persist the tenant's customer-list cache version is bumped, invalidating all
 * cached permutations at once (see {@link VersionedListCache}).
 */
export class CreateCustomerUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly customers: ICustomerRepository,
    cache: ICache = new NoOpCache(),
  ) {
    this.listCache = new VersionedListCache(cache, CUSTOMER_LIST_CACHE_NAMESPACE, 0);
  }

  async execute(input: CreateCustomerInputDto): Promise<CustomerOutput> {
    const email =
      input.email === undefined || input.email === null ? null : Email.create(input.email);
    const phone =
      input.phone === undefined || input.phone === null ? null : Phone.create(input.phone);
    const taxId =
      input.taxId === undefined || input.taxId === null ? null : TaxId.create(input.taxId);

    // Per-tenant email uniqueness (cross-aggregate invariant).
    if (email !== null && (await this.customers.existsByEmail(input.tenantId, email.value))) {
      throw new ConflictError('A customer with this email already exists', {
        field: 'email',
        email: email.value,
      });
    }

    // Per-tenant phone uniqueness (cross-aggregate invariant).
    if (phone !== null && (await this.customers.existsByPhone(input.tenantId, phone.value))) {
      throw new ConflictError('A customer with this phone already exists', {
        field: 'phone',
        phone: phone.value,
      });
    }

    const customer = Customer.create({
      tenantId: input.tenantId,
      name: input.name,
      email,
      phone,
      taxId,
      address: input.address ?? null,
      notes: input.notes ?? null,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });

    const saved = await this.customers.create(customer);
    await this.listCache.invalidate(input.tenantId);
    return toCustomerOutput(saved);
  }
}
