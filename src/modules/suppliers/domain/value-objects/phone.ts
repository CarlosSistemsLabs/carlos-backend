import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/** Inclusive digit-count bounds for a normalised phone number (E.164-friendly). */
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/** Internal attributes of a {@link Phone}. */
interface PhoneProps {
  value: string;
}

/**
 * Phone number value object (Suppliers module).
 *
 * On a {@link Supplier} the phone is *optional*; absence is modelled as `null`
 * on the entity, so this value object always represents a present, well-formed
 * number. Formatting characters (spaces, hyphens, parentheses, dots) are
 * stripped on creation and an optional leading `+` (country prefix) is
 * preserved, yielding a canonical, comparable form: two equivalent inputs
 * (`"+54 11 1234-5678"` / `"+541112345678"`) compare equal.
 */
export class Phone extends ValueObject<PhoneProps> {
  // Allowed input characters before normalisation.
  private static readonly ALLOWED_INPUT = /^[+\d\s().-]+$/;

  private constructor(props: PhoneProps) {
    super(props);
  }

  /**
   * Creates a validated, normalised {@link Phone}.
   *
   * @throws {ValidationError} when the value is empty, contains disallowed
   *   characters, or has a digit count outside `[7, 15]`.
   */
  static create(value: string): Phone {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError('Phone is required', { field: 'phone' });
    }

    const trimmed = value.trim();
    if (!Phone.ALLOWED_INPUT.test(trimmed)) {
      throw new ValidationError('Phone contains invalid characters', { field: 'phone' });
    }

    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');

    if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
      throw new ValidationError(
        `Phone must contain between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS} digits`,
        { field: 'phone' },
      );
    }

    return new Phone({ value: hasPlus ? `+${digits}` : digits });
  }

  /** The normalised phone number (digits only, optional leading `+`). */
  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
