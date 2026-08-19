import { Entity } from '@domain/entities/entity.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import { assertPaymentMethod, type PaymentMethod } from '../value-objects/payment-method.js';
import { InvalidPaymentLinkError, NonPositiveAmountError } from '../errors/cash-errors.js';

/** Attributes describing a payment against a sale or a purchase. */
export interface PaymentProps {
  tenantId: UUID;
  /** The settled sale, or `null` when this payment settles a purchase. */
  saleId: Nullable<UUID>;
  /** The settled purchase, or `null` when this payment settles a sale. */
  purchaseId: Nullable<UUID>;
  method: PaymentMethod;
  /** The (always positive) amount tendered. */
  amount: Money;
  reference: Nullable<string>;
  date: Date;
}

/** Input accepted by {@link Payment.create}. */
export interface CreatePaymentInput {
  tenantId: UUID;
  saleId?: Nullable<UUID>;
  purchaseId?: Nullable<UUID>;
  method: PaymentMethod;
  amount: Money;
  reference?: Nullable<string>;
  date?: Date;
}

/**
 * A payment settling a sale or a purchase (Requirement 9.1).
 *
 * **Link rule:** a payment references **exactly one** of `saleId` / `purchaseId`
 * — a sale payment is money coming in, a purchase payment is money going out.
 * Linking both (ambiguous) or neither (nothing to settle) is rejected with
 * {@link InvalidPaymentLinkError}. The amount is always strictly positive; the
 * direction is implied by which document is linked.
 *
 * The entity is immutable: a payment is a historical fact and never mutates
 * after creation. Recording a payment and reflecting it on the linked
 * sale/purchase (and, optionally, on a cash register) is orchestrated by
 * `RecordPaymentUseCase` (task 23.2); this entity only guarantees a payment is
 * internally valid.
 */
export class Payment extends Entity<PaymentProps> {
  private constructor(props: PaymentProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Creates a validated payment.
   *
   * @throws {ValidationError} when the method is not recognised.
   * @throws {NonPositiveAmountError} when the amount is not strictly positive.
   * @throws {InvalidPaymentLinkError} when not exactly one of sale/purchase is set.
   */
  static create(input: CreatePaymentInput, id?: UUID): Payment {
    const method = assertPaymentMethod(input.method);
    if (!input.amount.isPositive()) {
      throw new NonPositiveAmountError({ amount: input.amount.toString() });
    }
    const saleId = input.saleId ?? null;
    const purchaseId = input.purchaseId ?? null;
    const linkedToSale = saleId !== null;
    const linkedToPurchase = purchaseId !== null;
    if (linkedToSale === linkedToPurchase) {
      throw new InvalidPaymentLinkError({ saleId, purchaseId });
    }
    return new Payment(
      {
        tenantId: input.tenantId,
        saleId,
        purchaseId,
        method,
        amount: input.amount,
        reference: input.reference ?? null,
        date: input.date ?? new Date(),
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Payment} from already-validated persisted state. Trusts
   * the data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: PaymentProps): Payment {
    return new Payment({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get saleId(): Nullable<UUID> {
    return this.props.saleId;
  }

  get purchaseId(): Nullable<UUID> {
    return this.props.purchaseId;
  }

  get method(): PaymentMethod {
    return this.props.method;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get reference(): Nullable<string> {
    return this.props.reference;
  }

  get date(): Date {
    return this.props.date;
  }

  /** `true` when this payment settles a sale (money in). */
  get isSalePayment(): boolean {
    return this.props.saleId !== null;
  }

  /** `true` when this payment settles a purchase (money out). */
  get isPurchasePayment(): boolean {
    return this.props.purchaseId !== null;
  }
}
