import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import { Email } from '../value-objects/email.js';
import { Phone } from '../value-objects/phone.js';
import { TaxId } from '../value-objects/tax-id.js';

/** Attributes describing a supplier. */
export interface SupplierProps {
  tenantId: UUID;
  name: string;
  email: Nullable<Email>;
  phone: Nullable<Phone>;
  taxId: Nullable<TaxId>;
  address: Nullable<string>;
  notes: Nullable<string>;
  isActive: boolean;
}

/** Input accepted by {@link Supplier.create} when defining a new supplier. */
export interface CreateSupplierInput {
  tenantId: UUID;
  name: string;
  email?: Email | string | null;
  phone?: Phone | string | null;
  taxId?: TaxId | string | null;
  address?: Nullable<string>;
  notes?: Nullable<string>;
  isActive?: boolean;
}

/** Mutable contact fields accepted by {@link Supplier.updateContact}. */
export interface UpdateContactInput {
  email?: Email | string | null;
  phone?: Phone | string | null;
  taxId?: TaxId | string | null;
  address?: Nullable<string>;
  notes?: Nullable<string>;
}

/**
 * Supplier aggregate root (Requirements 9.1, 10.3).
 *
 * Encapsulates the business rules for a tenant's supplier: a required, non-empty
 * name and optional, well-formed contact details (email, phone, tax id) modelled
 * with dedicated value objects. Optional fields are `null` when absent. The
 * structure mirrors the {@link Customer} aggregate — suppliers are the
 * purchase-side counterpart of customers.
 *
 * **Contact-uniqueness invariant:** a supplier's email and phone must be unique
 * *per tenant* when provided. That invariant spans multiple aggregates, so it is
 * enforced at the use-case/repository level; the entity guarantees only that
 * each contact value it holds is individually well-formed.
 */
export class Supplier extends AggregateRoot<SupplierProps> {
  private constructor(props: SupplierProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Defines a brand new, active-by-default supplier, validating every invariant.
   *
   * @throws {ValidationError} when the name is empty or a contact field is
   *   malformed.
   */
  static create(input: CreateSupplierInput, id?: UUID): Supplier {
    const name = Supplier.assertName(input.name);

    return new Supplier(
      {
        tenantId: input.tenantId,
        name,
        email: Supplier.toEmail(input.email),
        phone: Supplier.toPhone(input.phone),
        taxId: Supplier.toTaxId(input.taxId),
        address: input.address ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Supplier} from already-validated persisted state. Trusts
   * the data store and performs no re-validation, mirroring the other module
   * aggregates.
   */
  static reconstitute(id: UUID, props: SupplierProps): Supplier {
    return new Supplier({ ...props }, id);
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

  /** Marks the supplier active so they appear in active listings. */
  activate(): void {
    this.props.isActive = true;
  }

  /** Marks the supplier inactive, hiding them from active listings. */
  deactivate(): void {
    this.props.isActive = false;
  }

  /**
   * Renames the supplier.
   *
   * @throws {ValidationError} when the new name is empty.
   */
  rename(name: string): void {
    this.props.name = Supplier.assertName(name);
  }

  /**
   * Updates contact details. Only fields present on `input` are changed; pass
   * `null` to clear an optional field.
   *
   * @throws {ValidationError} when a provided contact field is malformed.
   */
  updateContact(input: UpdateContactInput): void {
    if ('email' in input) {
      this.props.email = Supplier.toEmail(input.email);
    }
    if ('phone' in input) {
      this.props.phone = Supplier.toPhone(input.phone);
    }
    if ('taxId' in input) {
      this.props.taxId = Supplier.toTaxId(input.taxId);
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
      throw new ValidationError('Supplier name is required', { field: 'name' });
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
