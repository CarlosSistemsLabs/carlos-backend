import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import {
  stockMovementDelta,
  type StockMovementType,
} from '../value-objects/stock-movement-type.js';
import { InsufficientStockError } from '../errors/stock-errors.js';

/** Attributes describing the on-hand balance of a product at a location. */
export interface StockProps {
  tenantId: UUID;
  productId: UUID;
  /** The branch this balance belongs to; `null` means tenant-wide / unassigned. */
  branchId: Nullable<UUID>;
  /** On-hand quantity. A non-negative integer at all times. */
  quantity: number;
}

/** Input accepted by {@link Stock.create} when opening a new balance. */
export interface CreateStockInput {
  tenantId: UUID;
  productId: UUID;
  branchId?: Nullable<UUID>;
  /** Opening quantity. Defaults to `0`. Must be a non-negative integer. */
  quantity?: number;
}

/**
 * Stock aggregate root (Requirement 9.1).
 *
 * Represents the on-hand quantity of a single product at a single branch
 * (`branchId === null` denotes a tenant-wide balance). There is exactly one
 * balance per `(tenantId, productId, branchId)` triple
 * (`@@unique([tenantId, productId, branchId])`); that cross-row uniqueness is
 * enforced at the repository level, while the entity guards the core invariant:
 * **quantity is always a non-negative integer**.
 *
 * All mutations flow through {@link increase}/{@link decrease} (or
 * {@link applyMovement}); {@link decrease} refuses to drive the balance below
 * zero, throwing {@link InsufficientStockError}.
 */
export class Stock extends AggregateRoot<StockProps> {
  private constructor(props: StockProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Opens a new stock balance, validating the opening quantity.
   *
   * @throws {ValidationError} when `quantity` is not a non-negative integer.
   */
  static create(input: CreateStockInput, id?: UUID): Stock {
    const quantity = Stock.assertQuantity(input.quantity ?? 0);
    return new Stock(
      {
        tenantId: input.tenantId,
        productId: input.productId,
        branchId: input.branchId ?? null,
        quantity,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Stock} from already-validated persisted state. Trusts
   * the data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: StockProps): Stock {
    return new Stock({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get productId(): UUID {
    return this.props.productId;
  }

  get branchId(): Nullable<UUID> {
    return this.props.branchId;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  /**
   * Adds `quantity` units to the balance.
   *
   * @throws {ValidationError} when `quantity` is not a positive integer.
   */
  increase(quantity: number): void {
    this.props.quantity += Stock.assertPositiveQuantity(quantity);
  }

  /**
   * Removes `quantity` units from the balance.
   *
   * @throws {ValidationError} when `quantity` is not a positive integer.
   * @throws {InsufficientStockError} when the balance would go below zero.
   */
  decrease(quantity: number): void {
    const amount = Stock.assertPositiveQuantity(quantity);
    if (this.props.quantity - amount < 0) {
      throw new InsufficientStockError(this.props.quantity, amount);
    }
    this.props.quantity -= amount;
  }

  /**
   * Applies a movement of `quantity` units according to the type's sign
   * convention: `IN`/`ADJUSTMENT` increase, `OUT` decreases (guarded).
   *
   * `TRANSFER` is intentionally rejected here because it is a two-branch
   * operation, not a single-balance mutation; the application layer applies it
   * as a decrease on the source branch plus an increase on the destination.
   *
   * @throws {BusinessRuleError} when `type` is `TRANSFER`.
   * @throws {InsufficientStockError} when an `OUT` would go below zero.
   */
  applyMovement(type: StockMovementType, quantity: number): void {
    const delta = stockMovementDelta(type);
    if (delta === 1) {
      this.increase(quantity);
      return;
    }
    if (delta === -1) {
      this.decrease(quantity);
      return;
    }
    throw new BusinessRuleError(
      'TRANSFER movements must be applied as two legs (source decrease + destination increase)',
      { type },
    );
  }

  /**
   * Returns `true` when the on-hand quantity is at or below `minStock`,
   * signalling that a low-stock alert should fire (Requirement 9.1).
   */
  isLow(minStock: number): boolean {
    return this.props.quantity <= minStock;
  }

  private static assertQuantity(quantity: number): number {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new ValidationError('Stock quantity must be a non-negative integer', { quantity });
    }
    return quantity;
  }

  private static assertPositiveQuantity(quantity: number): number {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Movement quantity must be a positive integer', { quantity });
    }
    return quantity;
  }
}
