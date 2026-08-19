import { deepEqual } from '@shared/utils/deep-equal.js';

/**
 * Base class for all value objects.
 *
 * Value objects are immutable and have no identity. Two value objects are equal
 * when their attributes are structurally equal. Attributes are frozen on
 * construction to enforce immutability at runtime.
 *
 * @typeParam TProps - The shape of the value object's attributes.
 */
export abstract class ValueObject<TProps extends object> {
  protected readonly props: Readonly<TProps>;

  protected constructor(props: TProps) {
    this.props = Object.freeze({ ...props });
  }

  /**
   * Value-based equality. Returns `true` when `other` is a value object whose
   * attributes are structurally equal to this one's.
   */
  public equals(other?: ValueObject<TProps> | null): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (this === other) {
      return true;
    }
    if (!(other instanceof ValueObject)) {
      return false;
    }
    return deepEqual(this.props, other.props);
  }
}
