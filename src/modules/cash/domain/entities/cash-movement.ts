import { Entity } from '@domain/entities/entity.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import {
  assertCashMovementType,
  cashMovementDelta,
  type CashMovementType,
} from '../value-objects/cash-movement-type.js';
import {
  assertCashMovementCategory,
  type CashMovementCategory,
} from '../value-objects/cash-movement-category.js';
import { NonPositiveAmountError } from '../errors/cash-errors.js';

/** Attributes describing a single cash-register movement. */
export interface CashMovementProps {
  cashId: UUID;
  tenantId: UUID;
  userId: UUID;
  type: CashMovementType;
  category: CashMovementCategory;
  /** The (always positive) amount moved. Direction is carried by {@link type}. */
  amount: Money;
  reference: Nullable<string>;
  description: Nullable<string>;
  date: Date;
}

/** Input accepted by {@link CashMovement.create}. */
export interface CreateCashMovementInput {
  cashId: UUID;
  tenantId: UUID;
  userId: UUID;
  type: CashMovementType;
  category: CashMovementCategory;
  amount: Money;
  reference?: Nullable<string>;
  description?: Nullable<string>;
  date?: Date;
}

/**
 * An immutable cash-register movement (Requirement 9.1).
 *
 * Every movement carries a **strictly positive** {@link Money} amount; the
 * {@link CashMovementType} (`INCOME` / `EXPENSE`) — not the sign of the amount —
 * determines whether it credits or debits the register. The pairing of type and
 * {@link CashMovementCategory} also encodes the register lifecycle: an opening
 * float is `INCOME`/`opening`, a closing reconciliation is `INCOME`/`closing`
 * (overage) or `EXPENSE`/`closing` (shortage). The movement is a leaf entity: it
 * never mutates after creation, so the audit trail is append-only.
 */
export class CashMovement extends Entity<CashMovementProps> {
  private constructor(props: CashMovementProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Creates a validated movement.
   *
   * @throws {ValidationError} when the type/category are not recognised.
   * @throws {NonPositiveAmountError} when the amount is not strictly positive.
   */
  static create(input: CreateCashMovementInput, id?: UUID): CashMovement {
    const type = assertCashMovementType(input.type);
    const category = assertCashMovementCategory(input.category);
    if (!input.amount.isPositive()) {
      throw new NonPositiveAmountError({ amount: input.amount.toString() });
    }
    return new CashMovement(
      {
        cashId: input.cashId,
        tenantId: input.tenantId,
        userId: input.userId,
        type,
        category,
        amount: input.amount,
        reference: input.reference ?? null,
        description: input.description ?? null,
        date: input.date ?? new Date(),
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link CashMovement} from already-validated persisted state.
   * Trusts the data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: CashMovementProps): CashMovement {
    return new CashMovement({ ...props }, id);
  }

  get cashId(): UUID {
    return this.props.cashId;
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get userId(): UUID {
    return this.props.userId;
  }

  get type(): CashMovementType {
    return this.props.type;
  }

  get category(): CashMovementCategory {
    return this.props.category;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get reference(): Nullable<string> {
    return this.props.reference;
  }

  get description(): Nullable<string> {
    return this.props.description;
  }

  get date(): Date {
    return this.props.date;
  }

  /**
   * The signed effect this movement has on a register balance: the positive
   * {@link amount} for an `INCOME`, its negation for an `EXPENSE`.
   */
  get signedAmount(): Money {
    return this.props.amount.multiply(cashMovementDelta(this.props.type));
  }
}
