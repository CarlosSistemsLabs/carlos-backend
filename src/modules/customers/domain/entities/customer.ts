import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import { Email } from '../value-objects/email.js';
import { Phone } from '../value-objects/phone.js';
import { TaxId } from '../value-objects/tax-id.js';

/** Attributes describing a customer. */
export interface CustomerProps {
  tenantId: UUID;
  name: string;
  email: Nullable<Email>;
  phone: Nullable<Phone>;
  taxId: Nullable<TaxId>;
  address: Nullable<string>;
  notes: Nullable<string>;
  isActive: boolean;
}

/** Input accepted by {@link Customer.create} when defining a new customer. */
export interface CreateCustomerInput {
  tenantId: UUID;
  name: string;
  email?: Email | string | null;
  phone?: Phone | string | null;
  taxId?: TaxId | string | null;
  address?: Nullable<string>;
  notes?: Nullable<string>;
  isActive?: boolean;
}

/** Mutable contact fields accepted by {@link Customer.updateContact}. */
export interface UpdateContactInput {
  email?: Email | string | null;
  phone?: Phone | string | null;
  taxId?: TaxId | string | null;
  address?: Nullable<string>;
  notes?: Nullable<string>;
}

/**
 * Customer aggregate root (Requirements 9.1, 10.3).
 *
 * Encapsulates the business rules for a tenant's customer: a required, non-empty
 * name and optional, well-formed contact details (email, phone, tax id) modelled
 * with dedicated value objects. Optional fields are `null` when absent.
 *
 * **Contact-uniqueness invariant:** a customer's email and phone must be unique
 * *per tenant* when provided. That invariant spans multiple aggregates, so it is
 * enforced at the use-case/repository level (task 17.1); the entity guarantees
 * only that each contact value it holds is individually well-formed.
 */
export class Customer extends AggregateRoot<CustomerProps> {
  private constructor(props: CustomerProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Defines a brand new, active-by-default customer, validating every invariant.
   *
   * @throws {ValidationError} when the name is empty or a contact field is
   *   malformed.
   */
  static create(input: CreateCustomerInput, id?: UUID): Customer {
    const name = Customer.assertName(input.name);

    return new Customer(
      {
        tenantId: input.tenantId,
        name,
        email: Customer.toEmail(input.email),
        phone: Customer.toPhone(input.phone),
        taxId: Customer.toTaxId(input.taxId),
        address: input.address ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Customer} from already-validated persisted state. Trusts
   * the data store and performs no re-validation, mirroring the other module
   * aggregates.
   */
  static reconstitute(id: UUID, props: CustomerProps): Customer {
    return new Customer({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get name(): string {
    return this.props.name;
  }

  get email(): Nullable<Email> {
    return this.props.email;
  }

  get phone(): Nullable<Phone> {
    return this.props.phone;
  }

  get taxId(): Nullable<TaxId> {
    return this.props.taxId;
  }

  get address(): Nullable<string> {
    return this.props.address;
  }

  get notes(): Nullable<string> {
    return this.props.notes;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  /** Marks the customer active so they appear in active listings. */
  activate(): void {
    this.props.isActive = true;
  }

  /** Marks the customer inactive, hiding them from active listings. */
  deactivate(): void {
    this.props.isActive = false;
  }

  /**
   * Renames the customer.
   *
   * @throws {ValidationError} when the new name is empty.
   */
  rename(name: string): void {
    this.props.name = Customer.assertName(name);
  }

  /**
   * Updates contact details. Only fields present on `input` are changed; pass
   * `null` to clear an optional field.
   *
   * @throws {ValidationError} when a provided contact field is malformed.
   */
  updateContact(input: UpdateContactInput): void {
    if ('email' in input) {
      this.props.email = Customer.toEmail(input.email);
    }
    if ('phone' in input) {
      this.props.phone = Customer.toPhone(input.phone);
    }
    if ('taxId' in input) {
      this.props.taxId = Customer.toTaxId(input.taxId);
    }
    if ('address' in input) {
      this.props.address = input.address ?? null;
    }
    if ('notes' in input) {
      this.props.notes = input.notes ?? null;
    }
  }

  private static assertName(name: string): string {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Customer name is required', { field: 'name' });
    }
    return name.trim();
  }

  private static toEmail(value: Email | string | null | undefined): Nullable<Email> {
    if (value === null || value === undefined) {
      return null;
    }
    return value instanceof Email ? value : Email.create(value);
  }

  private static toPhone(value: Phone | string | null | undefined): Nullable<Phone> {
    if (value === null || value === undefined) {
      return null;
    }
    return value instanceof Phone ? value : Phone.create(value);
  }

  private static toTaxId(value: TaxId | string | null | undefined): Nullable<TaxId> {
    if (value === null || value === undefined) {
      return null;
    }
    return value instanceof TaxId ? value : TaxId.create(value);
  }
}
