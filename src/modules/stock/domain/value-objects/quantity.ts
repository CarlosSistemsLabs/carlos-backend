import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/** Internal attributes of a {@link Quantity}. */
interface QuantityProps {
  value: number;
}

/**
 * Non-negative integer quantity value object used for on-hand stock levels
 * (Requirement 9.1).
 *
 * Stock is counted in whole units, so fractional or non-finite values are
 * rejected. A stock level may legitimately be zero (out of stock) but never
 * negative — that invariant is enforced both here (a {@link Quantity} can never
 * hold a negative number) and by {@link Stock.decrease}, which refuses to drop
 * below zero.
 *
 * Movement quantities (how much a single {@link StockMovement} moves) are a
 * distinct concept: they must be *strictly positive*. Use
 * {@link Quantity.assertPositive} for those.
 */
export class Quantity extends ValueObject<QuantityProps> {
  private constructor(props: QuantityProps) {
    super(props);
  }

  /**
   * Creates a {@link Quantity} representing a non-negative on-hand stock level.
   *
   * @throws {ValidationError} when `value` is not a finite, non-negative integer.
   */
  static create(value: number): Quantity {
    Quantity.assertNonNegativeInteger(value);
    return new Quantity({ value });
  }

  /** The zero quantity (out of stock). */
  static zero(): Quantity {
    return new Quantity({ value: 0 });
  }

  /** The underlying non-negative integer. */
  get value(): number {
    return this.props.value;
  }

  /** Returns a new {@link Quantity} increased by `amount` (a positive integer). */
  add(amount: number): Quantity {
    Quantity.assertPositive(amount);
    return new Quantity({ value: this.props.value + amount });
  }

  /**
   * Returns a new {@link Quantity} decreased by `amount` (a positive integer),
   * or `null` when the subtraction would go below zero. Callers translate
   * `null` into an {@link InsufficientStockError}.
   */
  subtract(amount: number): Quantity | null {
    Quantity.assertPositive(amount);
    const next = this.props.value - amount;
    return next < 0 ? null : new Quantity({ value: next });
  }

  /** Validates that `value` is a finite, non-negative integer. */
  static assertNonNegativeInteger(value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError('Quantity must be a non-negative integer', { value });
    }
  }

  /**
   * Validates that `value` is a strictly positive integer (used for movement
   * quantities, which must move at least one unit).
   *
   * @throws {ValidationError} when `value` is not a positive integer.
   */
  static assertPositive(value: number): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError('Movement quantity must be a positive integer', { value });
    }
  }
}
